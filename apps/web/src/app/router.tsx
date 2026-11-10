import { createBrowserRouter } from "react-router";
import { StatusPage } from "../features/system/StatusPage";
import { AppLayout } from "../layouts/AppLayout";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [{ index: true, element: <StatusPage /> }],
  },
]);
