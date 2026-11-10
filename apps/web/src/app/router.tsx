import { createBrowserRouter } from "react-router";
import { AccountPage } from "../features/account/AccountPage";
import { CheckEmailPage } from "../features/auth/CheckEmailPage";
import { ForgotPasswordPage, ResetPasswordPage } from "../features/auth/PasswordResetPages";
import { RequireAuth } from "../features/auth/RequireAuth";
import { SignInPage, TwoFactorPage } from "../features/auth/SignInPage";
import { SignUpPage } from "../features/auth/SignUpPage";
import { ImportPage } from "../features/masterdata/ImportPage";
import { LocationsPage } from "../features/masterdata/LocationsPage";
import { PartnersPage } from "../features/masterdata/PartnersPage";
import { ProductDetailPage, ProductsPage } from "../features/masterdata/ProductsPage";
import { ProfilePage } from "../features/masterdata/ProfilePage";
import { HomePage } from "../features/orgs/HomePage";
import { InvitationPage } from "../features/orgs/InvitationPage";
import { OrgPage } from "../features/orgs/OrgPage";
import { VerificationsPage } from "../features/platform/VerificationsPage";
import { StatusPage } from "../features/system/StatusPage";
import { AppLayout } from "../layouts/AppLayout";
import { AuthLayout } from "../layouts/AuthLayout";
import { OrgLayout } from "../layouts/OrgLayout";

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: "/sign-in", element: <SignInPage /> },
      { path: "/sign-in/two-factor", element: <TwoFactorPage /> },
      { path: "/sign-up", element: <SignUpPage /> },
      { path: "/check-email", element: <CheckEmailPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/reset-password", element: <ResetPasswordPage /> },
    ],
  },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      {
        path: "/orgs/:orgId",
        element: <OrgLayout />,
        children: [
          { index: true, element: <OrgPage /> },
          { path: "profile", element: <ProfilePage /> },
          { path: "locations", element: <LocationsPage /> },
          { path: "partners", element: <PartnersPage /> },
          { path: "products", element: <ProductsPage /> },
          { path: "products/:productId", element: <ProductDetailPage /> },
          { path: "import", element: <ImportPage /> },
        ],
      },
      { path: "/platform/verifications", element: <VerificationsPage /> },
      { path: "/invitations/:invitationId", element: <InvitationPage /> },
      { path: "/account", element: <AccountPage /> },
      { path: "/status", element: <StatusPage /> },
    ],
  },
]);
