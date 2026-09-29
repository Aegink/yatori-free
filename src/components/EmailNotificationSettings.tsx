import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import {
  confirmEmailVerification,
  getEmailNotificationSettings,
  getUserFacingErrorMessage,
  isAuthExitError,
  requestEmailVerification,
  updateDeadlineEmailNotification,
  updateEmailNotification,
} from "@/lib/api";
import type { EmailNotificationSettings as EmailNotificationSettingsData } from "@/lib/api";
import { notifyAuthExit } from "@/lib/notifications";
import {
  getSessionCached,
  readSessionCache,
  writeSessionCache,
} from "@/lib/sessionCache";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface EmailNotificationSettingsProps {
  onUnauthorized: () => void;
}

type PendingAction =
  | "load"
  | "send"
  | "confirm"
  | "toggle"
  | "deadline"
  | null;
const EMAIL_NOTIFICATION_CACHE_KEY = "email-notification-settings";
const MAX_DEADLINE_REMINDERS = 5;
const MAX_DEADLINE_MINUTES = 43_200;

function formatReminderTime(minutes: number) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  return [
    days && `${days} 天`,
    hours && `${hours} 小时`,
    remainingMinutes && `${remainingMinutes} 分钟`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function EmailNotificationSettings({
  onUnauthorized,
}: EmailNotificationSettingsProps) {
  const initialSettings = readSessionCache<EmailNotificationSettingsData>(
    EMAIL_NOTIFICATION_CACHE_KEY,
  );
  const normalizedInitialSettings = initialSettings
    ? {
        ...initialSettings,
        deadlineReminderMinutes: initialSettings.deadlineReminderMinutes ?? [],
      }
    : null;
  const [settings, setSettings] =
    useState<EmailNotificationSettingsData | null>(
      () => normalizedInitialSettings,
    );
  const [email, setEmail] = useState(
    () => initialSettings?.pendingEmail || initialSettings?.email || "",
  );
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(() =>
    normalizedInitialSettings ? null : "load",
  );
  const [newReminderMinutes, setNewReminderMinutes] = useState("60");

  const handleError = useCallback(
    (error: unknown, fallback: string) => {
      if (isAuthExitError(error)) {
        notifyAuthExit(
          getUserFacingErrorMessage(error, "登录已失效，请重新登录"),
        );
        onUnauthorized();
        return;
      }

      toast.error(getUserFacingErrorMessage(error, fallback));
    },
    [onUnauthorized],
  );

  const applySettings = useCallback((next: EmailNotificationSettingsData) => {
    const normalized = {
      ...next,
      deadlineReminderMinutes: next.deadlineReminderMinutes ?? [],
    };
    writeSessionCache(EMAIL_NOTIFICATION_CACHE_KEY, normalized);
    setSettings(normalized);
    setEmail(next.pendingEmail || next.email);
  }, []);

  useEffect(() => {
    let cancelled = false;

    getSessionCached(EMAIL_NOTIFICATION_CACHE_KEY, async () => {
      const response = await getEmailNotificationSettings();
      return response.data;
    })
      .then((nextSettings) => {
        if (!cancelled) {
          applySettings(nextSettings);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          handleError(error, "获取邮箱通知设置失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPendingAction(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applySettings, handleError]);

  const handleRequestVerification = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const nextEmail = email.trim();
    if (!nextEmail) return;

    setPendingAction("send");
    try {
      const response = await requestEmailVerification({ email: nextEmail });
      applySettings(response.data);
      setVerificationCode("");
      toast.success("验证码已发送");
    } catch (error) {
      handleError(error, "发送验证码失败");
    } finally {
      setPendingAction(null);
    }
  };

  const handleConfirmVerification = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const code = verificationCode.trim();
    if (!code) return;

    setPendingAction("confirm");
    try {
      const response = await confirmEmailVerification({ code });
      applySettings(response.data);
      setVerificationCode("");
      toast.success("邮箱验证成功");
    } catch (error) {
      handleError(error, "验证邮箱失败");
    } finally {
      setPendingAction(null);
    }
  };

  const handleEnabledChange = async (enabled: boolean) => {
    setPendingAction("toggle");
    try {
      const response = await updateEmailNotification({ enabled });
      applySettings(response.data);
      toast.success(enabled ? "邮件通知已开启" : "邮件通知已关闭");
    } catch (error) {
      handleError(error, "更新邮件通知失败");
    } finally {
      setPendingAction(null);
    }
  };

  const handleDeadlineReminderChange = async (nextMinutes: number[]) => {
    setPendingAction("deadline");
    try {
      const response = await updateDeadlineEmailNotification({
        reminderMinutes: nextMinutes,
      });
      applySettings(response.data);
      toast.success(nextMinutes.length ? "临期邮件提醒已更新" : "临期邮件提醒已关闭");
    } catch (error) {
      handleError(error, "更新临期邮件提醒失败");
    } finally {
      setPendingAction(null);
    }
  };

  const handleAddDeadlineReminder = (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const minutes = Number(newReminderMinutes);
    const current = settings?.deadlineReminderMinutes ?? [];
    if (current.length >= MAX_DEADLINE_REMINDERS) {
      toast.error(`最多设置 ${MAX_DEADLINE_REMINDERS} 个提醒时间`);
      return;
    }
    if (
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > MAX_DEADLINE_MINUTES ||
      current.includes(minutes)
    ) {
      return;
    }
    void handleDeadlineReminderChange([...current, minutes]);
  };

  const handleRemoveDeadlineReminder = (minutes: number) => {
    const current = settings?.deadlineReminderMinutes ?? [];
    void handleDeadlineReminderChange(current.filter((item) => item !== minutes));
  };

  const isBusy = pendingAction !== null;
  const hasVerifiedEmail =
    settings?.verified === true && Boolean(settings.email);
  const hasPendingEmail = Boolean(settings?.pendingEmail);
  const deadlineReminderMinutes = settings?.deadlineReminderMinutes ?? [];
  const parsedReminderMinutes = Number(newReminderMinutes);
  const canAddReminder =
    newReminderMinutes.trim() !== "" &&
    Number.isInteger(parsedReminderMinutes) &&
    parsedReminderMinutes >= 1 &&
    parsedReminderMinutes <= MAX_DEADLINE_MINUTES &&
    !deadlineReminderMinutes.includes(parsedReminderMinutes);
  const statusText = !settings?.available
    ? "邮件服务暂不可用"
    : hasPendingEmail
      ? `待验证：${settings.pendingEmail}`
      : hasVerifiedEmail
        ? `已验证：${settings.email}`
        : "验证邮箱后可接收邮件";

  return (
    <div className="space-y-2">
      <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3.5 shadow-xs sm:space-y-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-1 pr-3 sm:pr-4">
            <Label
              htmlFor="emailNotificationEnabled"
              className="block cursor-pointer text-sm font-semibold text-foreground"
            >
              邮件通知总开关
            </Label>
            <p
              className="truncate text-xs leading-relaxed text-muted-foreground"
              title={hasPendingEmail ? settings?.pendingEmail : undefined}
            >
              {statusText}
            </p>
          </div>
          <Switch
            id="emailNotificationEnabled"
            checked={settings?.enabled ?? false}
            disabled={!hasVerifiedEmail || !settings?.available || isBusy}
            onCheckedChange={(checked: boolean) =>
              void handleEnabledChange(checked)
            }
            className="shrink-0"
          />
        </div>

        {pendingAction === "load" ? (
          <p className="text-xs text-muted-foreground">正在读取邮箱设置...</p>
        ) : (
          <div className="animate-in fade-in-0 slide-in-from-top-1 duration-280 ease-emphasized motion-reduce:animate-none">
            <div
              className={`grid grid-cols-1 gap-2.5 border-t border-border/40 pt-3 sm:gap-3 sm:pt-4 ${hasPendingEmail ? "lg:grid-cols-2 lg:gap-4" : ""}`}
            >
              <form
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2"
                onSubmit={handleRequestVerification}
              >
                <Label htmlFor="notificationEmail" className="sr-only">
                  邮箱地址
                </Label>
                <Input
                  id="notificationEmail"
                  type="email"
                  value={email}
                  disabled={!settings?.available || isBusy}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="邮箱地址"
                  autoComplete="email"
                  required
                  className="bg-background text-[13px] md:text-[13px]"
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!settings?.available || isBusy || !email.trim()}
                >
                  {pendingAction === "send" ? "发送中..." : "发送验证码"}
                </Button>
              </form>

              {hasPendingEmail && (
                <form
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2"
                  onSubmit={handleConfirmVerification}
                >
                  <Label htmlFor="emailVerificationCode" className="sr-only">
                    邮箱验证码
                  </Label>
                  <Input
                    id="emailVerificationCode"
                    value={verificationCode}
                    disabled={isBusy}
                    onChange={(event) => setVerificationCode(event.target.value)}
                    placeholder="验证码"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    className="bg-background text-[13px] md:text-[13px]"
                  />
                  <Button
                    type="submit"
                    disabled={isBusy || !verificationCode.trim()}
                  >
                    {pendingAction === "confirm" ? "验证中..." : "确认验证"}
                  </Button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/20 p-3.5 shadow-xs sm:p-5">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">任务状态通知</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            任务成功或失败时发送，跟随邮件通知总开关
          </p>
        </div>
        <Switch
          checked
          disabled
          aria-label="任务状态通知常开，跟随邮件通知总开关"
          style={{
            opacity:
              settings?.enabled && hasVerifiedEmail && settings.available
                ? 1
                : undefined,
          }}
        />
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3.5 shadow-xs sm:space-y-4 sm:p-5">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">
            临期未完成通知
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            未完成作业、考试及含未完成任务点的课程结课前发送
          </p>
        </div>

        {pendingAction === "load" ? (
          <p className="text-xs text-muted-foreground">正在读取提醒设置...</p>
        ) : (
          <div className="space-y-3 border-t border-border/40 pt-3 sm:pt-4">
            {deadlineReminderMinutes.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-live="polite">
                {deadlineReminderMinutes.map((minutes) => (
                  <span
                    key={minutes}
                    className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground"
                  >
                    {formatReminderTime(minutes)}前
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`删除提前 ${minutes} 分钟提醒`}
                      disabled={!hasVerifiedEmail || !settings?.available || isBusy}
                      onClick={() => handleRemoveDeadlineReminder(minutes)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </span>
                ))}
              </div>
            )}

            <form
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
              onSubmit={handleAddDeadlineReminder}
            >
              <Label htmlFor="deadlineReminderMinutes" className="sr-only">
                提前分钟数
              </Label>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  id="deadlineReminderMinutes"
                  type="number"
                  min={1}
                  max={MAX_DEADLINE_MINUTES}
                  step={1}
                  value={newReminderMinutes}
                  disabled={!hasVerifiedEmail || !settings?.available || isBusy}
                  onChange={(event) => setNewReminderMinutes(event.target.value)}
                  className="min-w-0 flex-1 bg-background text-[13px] md:text-[13px]"
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  分钟
                </span>
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={
                  !hasVerifiedEmail ||
                  !settings?.available ||
                  isBusy ||
                  !canAddReminder
                }
              >
                添加提醒
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
