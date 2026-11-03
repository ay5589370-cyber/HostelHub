import {
  LayoutDashboard,
  Users,
  DoorOpen,
  CalendarClock,
  ScanLine,
  UtensilsCrossed,
  MessageSquare,
  Wallet,
  Package,
  Megaphone,
  ChartNoAxesCombined,
  Settings,
  BellRing,
  ContactRound,
} from "lucide-react";
export const navigation = [
  { label: "Dashboard", path: "dashboard", icon: LayoutDashboard },
  {
    label: "Students",
    path: "students",
    icon: Users,
    description:
      "Invite students, manage resident profiles, and keep your campus directory in one place.",
  },
  {
    label: "Rooms & Beds",
    path: "rooms",
    icon: DoorOpen,
    description:
      "Organize hostel blocks, assign beds, and see room availability at a glance.",
  },
  {
    label: "Leave Requests",
    path: "leave-requests",
    icon: CalendarClock,
    description:
      "Review day-out and night-out requests with a clear approval trail.",
  },
  {
    label: "Gate Management",
    path: "gate",
    icon: ScanLine,
    description:
      "Verify digital gate passes and track student entry and exit securely.",
  },
  {
    label: "Mess Management",
    path: "mess",
    icon: UtensilsCrossed,
    description:
      "Publish meal timetables and keep residents informed about their daily menu.",
  },
  {
    label: "Complaints",
    path: "complaints",
    icon: MessageSquare,
    description:
      "Give every resident concern a clear path from submission to resolution.",
  },
  {
    label: "Fees & Payments",
    path: "fees",
    icon: Wallet,
    phase: 6,
    description:
      "Bring hostel fees, payment records, and outstanding balances together.",
  },
  {
    label: "Inventory & Assets",
    path: "inventory",
    icon: Package,
    phase: 12,
    description: "Track fixed assets, movements, maintenance links, and consumable stock.",
  },
  {
    label: "Announcements",
    path: "announcements",
    icon: Megaphone,
    phase: 6,
    description: "Share timely campus updates with the people who need them.",
  },
  {
    label: "Reports & Analytics",
    path: "reports",
    icon: ChartNoAxesCombined,
    description: "Turn operational data into useful insights for your campus.",
  },
  {
    label: "Notifications & Guardians",
    path: "notifications",
    icon: BellRing,
    description:
      "Review administrator alerts and parent communication readiness.",
  },
  {
    label: "Visitors",
    path: "visitors",
    icon: ContactRound,
    description:
      "Register visitors and review identity checks, approvals, and gate entry/exit history.",
  },
  { label: "Settings", path: "settings", icon: Settings },
];
