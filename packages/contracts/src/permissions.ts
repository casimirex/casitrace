import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * Organisation permissions (roadmap-v2 §4.3): each permission is (resource, action).
 * Better Auth enforces the organisation/member/invitation entries on its own endpoints;
 * the API enforces the business entries with `can()` in the application layer.
 * Add business resources here as phases introduce them.
 */
export const statements = {
  ...defaultStatements,
  audit: ["read"],
} as const;

export const ac = createAccessControl(statements);

export const ROLE_NAMES = ["owner", "admin", "operator", "reviewer", "viewer"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const roles = {
  owner: ac.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    audit: ["read"],
  }),
  admin: ac.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    audit: ["read"],
  }),
  operator: ac.newRole({}),
  reviewer: ac.newRole({}),
  viewer: ac.newRole({}),
} satisfies Record<RoleName, unknown>;

type Statements = typeof statements;
export type Permission = {
  [R in keyof Statements]: `${R & string}:${Statements[R][number]}`;
}[keyof Statements];

export const isRoleName = (value: string): value is RoleName =>
  (ROLE_NAMES as readonly string[]).includes(value);

/** True when the role template grants the permission. Unknown roles get nothing. */
export const can = (role: string, permission: Permission): boolean => {
  if (!isRoleName(role)) return false;
  const [resource, action] = permission.split(":") as [keyof Statements, string];
  const result = roles[role].authorize({ [resource]: [action] } as never);
  return result.success;
};

export const PLATFORM_ROLES = ["super_admin", "support"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
