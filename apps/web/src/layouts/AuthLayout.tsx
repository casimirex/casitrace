import { Outlet } from "react-router";

export function AuthLayout() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-lg font-semibold tracking-tight">Casitrace</p>
        <div className="rounded border border-line bg-surface p-6">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
