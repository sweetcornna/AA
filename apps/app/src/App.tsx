import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Centered, Spinner } from "./components/ui";
import { useAuth } from "./features/auth/AuthProvider";
import { supabaseConfigurationError } from "./lib/supabase";

const ActivityPage = lazy(() =>
  import("./features/activity/ActivityPage").then((m) => ({
    default: m.ActivityPage,
  })),
);
const LoginPage = lazy(() =>
  import("./features/auth/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import("./features/auth/RegisterPage").then((m) => ({
    default: m.RegisterPage,
  })),
);
const CircleDetailPage = lazy(() =>
  import("./features/circles/CircleDetailPage").then((m) => ({
    default: m.CircleDetailPage,
  })),
);
const CirclesPage = lazy(() =>
  import("./features/circles/CirclesPage").then((m) => ({
    default: m.CirclesPage,
  })),
);
const AddExpensePage = lazy(() =>
  import("./features/expenses/AddExpensePage").then((m) => ({
    default: m.AddExpensePage,
  })),
);
const JoinPage = lazy(() =>
  import("./features/invitations/JoinPage").then((m) => ({
    default: m.JoinPage,
  })),
);
const ProfilePage = lazy(() =>
  import("./features/profile/ProfilePage").then((m) => ({
    default: m.ProfilePage,
  })),
);

const shell = (node: ReactNode) => <AppShell>{node}</AppShell>;

export function App() {
  const { error, loading, session } = useAuth();

  if (supabaseConfigurationError) {
    return (
      <Centered>
        <div className="max-w-sm px-6 text-center">
          <h1 className="text-[20px] font-semibold">应用配置错误</h1>
          <p
            className="mt-2 text-[14px] leading-relaxed"
            style={{ color: "var(--red)" }}
          >
            {supabaseConfigurationError}
          </p>
          <p
            className="mt-3 text-[13px] leading-relaxed"
            style={{ color: "var(--label2)" }}
          >
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
        <p
          className="max-w-sm px-6 text-center text-[14px]"
          style={{ color: "var(--red)" }}
        >
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
      <Suspense
        fallback={
          <Centered>
            <Spinner />
          </Centered>
        }
      >
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense
      fallback={
        <Centered>
          <Spinner />
        </Centered>
      }
    >
      <Routes>
        <Route path="/" element={shell(<CirclesPage />)} />
        <Route path="/activity" element={shell(<ActivityPage />)} />
        <Route path="/assistant" element={<Navigate to="/" replace />} />
        <Route path="/profile" element={shell(<ProfilePage />)} />
        <Route
          path="/circles/:circleId"
          element={shell(<CircleDetailPage />)}
        />
        <Route
          path="/circles/:circleId/add"
          element={shell(<AddExpensePage />)}
        />
        <Route path="/join" element={<JoinPage />} />
        <Route path="*" element={shell(<CirclesPage />)} />
      </Routes>
    </Suspense>
  );
}
