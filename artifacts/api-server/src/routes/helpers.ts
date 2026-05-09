export function parseNumeric(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = typeof value === "number" ? value : parseFloat(String(value));
  return isNaN(num) ? undefined : num;
}

export function getUserFromRequest(req: any): { id: string; role: string } | null {
  if (req.teamUser) {
    return { id: req.teamUser.id, role: req.teamUser.role };
  }
  if (req.user?.claims?.sub) {
    return { id: req.user.claims.sub, role: "super_admin" };
  }
  return null;
}

export function requireSuperAdmin(req: any, res: any): { id: string; role: string } | null {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (user.role !== "super_admin") {
    res.status(403).json({ error: "Super Admin access required" });
    return null;
  }
  return user;
}

export function requireTeamOrSuperAdmin(req: any, res: any): { id: string; role: string } | null {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (user.role !== "super_admin" && user.role !== "team_member") {
    res.status(403).json({ error: "Team Member or Super Admin access required" });
    return null;
  }
  return user;
}
