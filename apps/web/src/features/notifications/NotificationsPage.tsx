import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Button, Card, PageTitle } from "../../components/ui";
import { api, unwrap } from "../../lib/api";

export const useNotifications = () =>
  useQuery({
    queryKey: ["notifications"],
    queryFn: async () => unwrap(await api.GET("/v1/me/notifications", { params: { query: {} } })),
    refetchInterval: 60_000,
  });

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const list = useNotifications();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
  const readAll = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/me/notifications/read-all")),
    onSuccess: refresh,
  });
  const read = async (id: string) => {
    unwrap(
      await api.POST("/v1/me/notifications/{notificationId}/read", {
        params: { path: { notificationId: id } },
      }),
    );
    await refresh();
  };
  return (
    <>
      <PageTitle title="Notifications" />
      <Card
        actions={
          list.data?.unread ? (
            <Button variant="secondary" onClick={() => readAll.mutate()}>
              Mark all read
            </Button>
          ) : undefined
        }
      >
        {list.data?.items.length === 0 && <p className="text-muted">Nothing yet.</p>}
        <ul className="divide-y divide-line" aria-label="Notifications">
          {list.data?.items.map((n) => (
            <li key={n.id} className={`grid gap-0.5 py-2.5 ${n.readAt ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {n.link ? (
                  <Link
                    to={n.link}
                    className="font-medium text-brand hover:underline"
                    onClick={() => read(n.id)}
                  >
                    {n.title}
                  </Link>
                ) : (
                  <span className="font-medium">{n.title}</span>
                )}
                <span className="text-xs tabular-nums text-muted">{when.format(new Date(n.createdAt))}</span>
              </div>
              <p className="text-sm text-muted">{n.body}</p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
