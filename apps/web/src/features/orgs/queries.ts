import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "../../lib/api";

export const useMe = () =>
  useQuery({ queryKey: ["me"], queryFn: async () => unwrap(await api.GET("/v1/me")) });

export const useOrg = (orgId: string) =>
  useQuery({
    queryKey: ["org", orgId],
    queryFn: async () => unwrap(await api.GET("/v1/orgs/{orgId}", { params: { path: { orgId } } })),
  });
