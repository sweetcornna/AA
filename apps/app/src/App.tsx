import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Centered, Spinner } from "./components/ui";
import { ActivityPage } from "./features/activity/ActivityPage";
import { AssistantPage } from "./features/assistant/AssistantPage";
import { useAuth } from "./features/auth/AuthProvider";
import { LoginPage } from "./features/auth/LoginPage";
import { RegisterPage } from "./features/auth/RegisterPage";
import { CircleDetailPage } from "./features/circles/CircleDetailPage";
import { CirclesPage } from "./features/circles/CirclesPage";
import { AddExpensePage } from "./features/expenses/AddExpensePage";
import { JoinPage } from "./features/invitations/JoinPage";
import { ProfilePage } from "./features/profile/ProfilePage";
import { supabaseConfigurationError } from "./lib/supabase";

const shell = (node: ReactNode) => <AppShell>{node}</AppShell>;

export function App() {
  const { error, loading, session } = useAuth();

  if (supabaseConfigurationError) {
    return (
      <Centered>
        <div className="max-w-sm px-6 text-center">
          <h1 className="text-[20px] font-semibold">应用配置错误</h1>
          <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--red)" }}>
            {supabaseConfigurationError}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--label2)" }}>
            请安装已正确配置的 AA 版本，或联系发布者重新构建应用。
          </p>
        </div>
      </Centered>
    );
  }

  if (loading) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  }

  if (error) {
    return (
      <Centered>
        <p className="max-w-sm px-6 text-center text-[14px]" style={{ color: "var(--red)" }}>
          无法读取登录状态：{error}
        </p>
      </Centered>
    );
  }

  // Not signed in: only login / register are reachable. The current hash route
  // (e.g. #/join?token=…) is preserved, so after login the user lands back
  // where the invite pointed.
  if (!session) {
    return (
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={shell(<CirclesPage />)} />
      <Route path="/activity" element={shell(<ActivityPage />)} />
      <Route path="/assistant" element={shell(<AssistantPage />)} />
      <Route path="/profile" element={shell(<ProfilePage />)} />
      <Route path="/circles/:circleId" element={shell(<CircleDetailPage />)} />
      <Route path="/circles/:circleId/add" element={<AddExpensePage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="*" element={shell(<CirclesPage />)} />
    </Routes>
  );
}
