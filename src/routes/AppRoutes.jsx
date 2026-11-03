import { Route, Routes, Link, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { ProtectedRoute, RoleGuard, HomeRedirect, SetupNotice } from "./Guards";
import { navigation } from "./navigation";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import Login from "../pages/auth/Login";
import Password from "../pages/auth/Password";
import Unauthorized from "../pages/auth/Unauthorized";
const Dashboard = lazy(() => import("../pages/admin/Dashboard"));
const Settings = lazy(() => import("../pages/admin/Settings"));
const Students = lazy(() => import("../pages/admin/Students"));
const StudentRegistration = lazy(
  () => import("../pages/admin/StudentRegistration"),
);
const StudentProfile = lazy(() => import("../pages/admin/StudentProfile"));
const Rooms = lazy(() => import("../pages/admin/Rooms"));
const LeaveRequests = lazy(() => import("../pages/admin/LeaveRequests"));
const GateManagement = lazy(() => import("../pages/admin/GateManagement"));
const AdminFees = lazy(() => import("../pages/admin/Fees"));
const AdminInventory = lazy(() => import("../pages/admin/Inventory"));
const AdminMess = lazy(() => import("../pages/admin/Mess"));
const AdminReports = lazy(() => import("../pages/admin/Reports"));
const AdminNotifications = lazy(() => import("../pages/notifications/Center"));
const AdminVisitors = lazy(() => import("../pages/visitors/Visitors"));
const StaffComplaints = lazy(() => import("../pages/complaints/StaffQueue"));
const StaffComplaintDetail = lazy(
  () => import("../pages/complaints/StaffDetail"),
);
import ModulePlaceholder from "../pages/admin/ModulePlaceholder";
const StudentDashboard = lazy(() => import("../pages/student/Dashboard"));
const StudentNotifications = lazy(
  () => import("../pages/notifications/Center"),
);
const StudentVisitors = lazy(() => import("../pages/visitors/Visitors"));
const StudentLeave = lazy(() => import("../pages/student/Leave"));
const StudentGatePasses = lazy(() => import("../pages/student/GatePasses"));
const StudentFees = lazy(() => import("../pages/student/Fees"));
const StudentComplaints = lazy(() => import("../pages/student/Complaints"));
const StudentComplaintDetail = lazy(
  () => import("../pages/student/ComplaintDetail"),
);
const WardenVisitors = lazy(() => import("../pages/visitors/Visitors"));
const GateVerify = lazy(() => import("../pages/security/GateVerify"));
const SecurityGuards = lazy(() => import("../pages/admin/SecurityGuards"));
import WardenDashboard from "../pages/warden/Dashboard";
import { EmptyState, LoadingSkeleton } from "../components/common/Feedback";
export default function AppRoutes() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/setup" element={<SetupNotice />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<Password />} />
        <Route path="/reset-password" element={<Password reset />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<RoleGuard role="admin" />}>
            <Route path="/admin" element={<DashboardLayout />}>
              <Route index element={<HomeRedirect />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="settings" element={<Settings />} />
              <Route path="students" element={<Students />} />
              <Route path="students/new" element={<StudentRegistration />} />
              <Route path="students/:id" element={<StudentProfile />} />
              <Route path="rooms" element={<Rooms />} />
              <Route path="leave-requests" element={<LeaveRequests />} />
              <Route path="gate" element={<GateManagement />} />
              <Route path="security-guards" element={<SecurityGuards />} />
              <Route path="fees" element={<AdminFees />} />
              <Route path="inventory" element={<AdminInventory />} />
              <Route path="mess" element={<AdminMess />} />
              <Route path="reports" element={<AdminReports />} />
              <Route
                path="notifications"
                element={<AdminNotifications admin />}
              />
              <Route path="visitors" element={<AdminVisitors mode="admin" />} />
              <Route path="complaints" element={<StaffComplaints />} />
              <Route path="complaints/:id" element={<StaffComplaintDetail />} />
              {navigation
                .filter(
                  (n) =>
                    n.phase &&
                    n.phase !== 2 &&
                    n.path !== "fees" &&
                    n.path !== "inventory" &&
                    n.path !== "mess" &&
                    n.path !== "reports" &&
                    n.path !== "notifications" &&
                    n.path !== "visitors" &&
                    n.path !== "complaints" &&
                    n.path !== "security-guards",
                )
                .map((module) => (
                  <Route
                    key={module.path}
                    path={module.path}
                    element={<ModulePlaceholder module={module} />}
                  />
                ))}
            </Route>
          </Route>
          <Route element={<RoleGuard role="student" />}>
            <Route path="/student/dashboard" element={<StudentDashboard />} />
            <Route
              path="/student/notifications"
              element={<StudentNotifications />}
            />
            <Route
              path="/student/visitors"
              element={<StudentVisitors mode="student" />}
            />
            <Route
              path="/student/profile"
              element={<StudentDashboard profile />}
            />
            <Route path="/student/leave" element={<StudentLeave />} />
            <Route path="/student/gate-passes" element={<StudentGatePasses />} />
            <Route path="/student/fees" element={<StudentFees />} />
            <Route path="/student/mess" element={<Navigate to="/student/dashboard" replace />} />
            <Route path="/student/complaints" element={<StudentComplaints />} />
            <Route
              path="/student/complaints/:id"
              element={<StudentComplaintDetail />}
            />
            <Route
              path="/student/leave/history"
              element={<StudentLeave history />}
            />
          </Route>
          <Route element={<RoleGuard role="warden" />}>
            <Route path="/warden/dashboard" element={<WardenDashboard />} />
            <Route
              path="/warden/visitors"
              element={<WardenVisitors mode="warden" />}
            />
            <Route path="/warden/complaints" element={<StaffComplaints />} />
            <Route
              path="/warden/complaints/:id"
              element={<StaffComplaintDetail />}
            />
          </Route>
          <Route element={<RoleGuard role="security_guard" />}>
            <Route path="/gate/scan" element={<GateVerify scan />} />
            <Route path="/gate/verify" element={<GateVerify />} />
          </Route>
        </Route>
        <Route
          path="*"
          element={
            <main className="center-page">
              <EmptyState
                title="Page not found"
                description="This page may have moved or doesn’t exist."
              >
                <Link to="/">Return to workspace</Link>
              </EmptyState>
            </main>
          }
        />
      </Routes>
    </Suspense>
  );
}
