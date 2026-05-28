import { Navigate, Route, Routes } from "react-router-dom";

import { AdminAuthGate } from "./auth/AdminAuthGate";
import { AdminLayout } from "./layout/AdminLayout";
import { allAdminRoutes } from "./routes";
import { ApprovalsPage } from "../features/approvals/ApprovalsPage";
import { ArchivePage } from "../features/archive/ArchivePage";
import { ArmoryPage } from "../features/armory/ArmoryPage";
import { OpsAgentPage } from "../features/ops/OpsAgentPage";
import { PlaceholderPage } from "../features/placeholders/PlaceholderPage";
import { ContentLabPage } from "../features/product/ContentLabPage";
import { MaatOpsPage } from "../features/product/MaatOpsPage";
import { NodeDraftsPage } from "../features/product/NodeDraftsPage";
import { TreasuryPage } from "../features/treasury/TreasuryPage";
import { WarRoomDashboardPage } from "../features/war-room/WarRoomDashboardPage";

const agentRouteMap = {
  "/ops/research": "research",
  "/ops/social": "social",
  "/ops/copy": "copy",
  "/ops/suggest-updates": "suggest_updates",
  "/ops/product-qa": "product_qa",
  "/ops/chief-operator": "chief_operator",
} as const;

function routeElement(routePath: string) {
  if (routePath === "/war-room/dashboard" || routePath === "/war-room/metrics") {
    return <WarRoomDashboardPage />;
  }
  if (routePath === "/war-room/reports") {
    return <OpsAgentPage agentSlug="chief_operator" />;
  }
  if (routePath === "/product/content-lab") return <ContentLabPage />;
  if (routePath === "/product/maat") return <MaatOpsPage />;
  if (routePath === "/product/nodes") return <NodeDraftsPage />;
  if (routePath === "/infrastructure/archive") return <ArchivePage />;
  if (routePath === "/infrastructure/armory") return <ArmoryPage />;
  if (routePath === "/infrastructure/approvals") return <ApprovalsPage />;
  if (routePath === "/infrastructure/treasury") return <TreasuryPage />;

  const agentSlug = agentRouteMap[routePath as keyof typeof agentRouteMap];
  if (agentSlug) return <OpsAgentPage agentSlug={agentSlug} />;

  const route = allAdminRoutes.find((item) => item.path === routePath);
  return route ? <PlaceholderPage route={route} /> : null;
}

export function App() {
  return (
    <AdminAuthGate>
      {(admin) => (
        <AdminLayout admin={admin}>
          <Routes>
            <Route path="/" element={<Navigate to="/product/overview" replace />} />
            {allAdminRoutes.map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={routeElement(route.path)}
              />
            ))}
            <Route
              path="*"
              element={<Navigate to="/product/overview" replace />}
            />
          </Routes>
        </AdminLayout>
      )}
    </AdminAuthGate>
  );
}
