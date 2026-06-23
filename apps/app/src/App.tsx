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

const shell = (node: ReactNode) => <AppShell>{node}</AppShell>;

export function App() {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <Centered>
        <Spinner />
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
