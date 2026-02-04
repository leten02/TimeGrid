import { useLocation, useNavigate } from "react-router-dom";

const NavIcon = ({ children, active }) => (
  <div style={{ ...styles.iconWrap, ...(active ? styles.iconWrapActive : {}) }}>
    {children}
  </div>
);

const CalendarIcon = ({ active }) => (
  <NavIcon active={active}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="16" rx="3" stroke={active ? "#fff" : "#0f172a"} strokeWidth="1.6" />
      <path d="M7 3v4M17 3v4M3 9h18" stroke={active ? "#fff" : "#0f172a"} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  </NavIcon>
);

const TasksIcon = ({ active }) => (
  <NavIcon active={active}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="3" width="16" height="18" rx="3" stroke={active ? "#fff" : "#0f172a"} strokeWidth="1.6" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke={active ? "#fff" : "#0f172a"} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  </NavIcon>
);

const ReportsIcon = ({ active }) => (
  <NavIcon active={active}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 20V10M10 20V4M16 20v-6M22 20H2" stroke={active ? "#fff" : "#0f172a"} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  </NavIcon>
);

const SetupIcon = ({ active }) => (
  <NavIcon active={active}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke={active ? "#fff" : "#0f172a"} strokeWidth="1.6" />
      <path d="M12 7v5l3 3" stroke={active ? "#fff" : "#0f172a"} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  </NavIcon>
);

const SettingsIcon = ({ active }) => (
  <NavIcon active={active}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 8a4 4 0 100 8 4 4 0 000-8z" stroke={active ? "#fff" : "#0f172a"} strokeWidth="1.6" />
      <path d="M4 12h2M18 12h2M12 4v2M12 18v2M6.5 6.5l1.4 1.4M16.1 16.1l1.4 1.4M17.5 6.5l-1.4 1.4M7.9 16.1l-1.4 1.4" stroke={active ? "#fff" : "#0f172a"} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  </NavIcon>
);

const navItems = [
  { label: "Week", path: "/week", icon: CalendarIcon },
  { label: "Tasks", path: "/tasks", icon: TasksIcon },
  { label: "Setup", path: "/setup", icon: SetupIcon },
  { label: "Reports", path: "/reports", icon: ReportsIcon },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <aside style={styles.sidebar}>
      <div style={styles.brand} onClick={() => navigate("/week")}>
        <div style={styles.brandIcon}>
          <img src="/brand/timegrid_mark.png" alt="TimeGrid" style={styles.brandImage} />
        </div>
        <span style={styles.brandText}>TimeGrid</span>
      </div>

      <nav style={styles.nav}>
        {navItems.map((item) => {
          const active = pathname.startsWith(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              style={{ ...styles.navItem, ...(active ? styles.navItemActive : {}) }}
            >
              <Icon active={active} />
              <span style={{ ...styles.navLabel, ...(active ? styles.navLabelActive : {}) }}>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div style={styles.bottom}>
        <button
          type="button"
          onClick={() => navigate("/settings")}
          style={{ ...styles.navItem, ...(pathname.startsWith("/settings") ? styles.navItemActive : {}) }}
        >
          <SettingsIcon active={pathname.startsWith("/settings")} />
          <span style={{ ...styles.navLabel, ...(pathname.startsWith("/settings") ? styles.navLabelActive : {}) }}>
            Settings
          </span>
        </button>
      </div>
    </aside>
  );
}

const styles = {
  sidebar: {
    width: 96,
    padding: "20px 12px",
    borderRight: "1px solid rgba(15,23,42,0.08)",
    background: "white",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  },
  brand: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
  },
  brandIcon: {
    width: 40,
    height: 40,
    display: "grid",
    placeItems: "center",
  },
  brandImage: {
    width: 28,
    height: 28,
    objectFit: "contain",
  },
  brandText: {
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.3px",
  },
  nav: {
    display: "grid",
    gap: 10,
    width: "100%",
    marginTop: 8,
  },
  navItem: {
    border: "none",
    background: "transparent",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    padding: "10px 0",
    borderRadius: 16,
    cursor: "pointer",
  },
  navItemActive: {
    background: "#0f172a",
    boxShadow: "0 10px 20px rgba(15,23,42,0.18)",
  },
  navLabel: {
    fontSize: 11,
    color: "#475569",
  },
  navLabelActive: {
    color: "white",
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    display: "grid",
    placeItems: "center",
    background: "rgba(15,23,42,0.04)",
  },
  iconWrapActive: {
    background: "rgba(255,255,255,0.15)",
  },
  bottom: {
    marginTop: "auto",
    width: "100%",
  },
};
