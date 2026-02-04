import { BrowserRouter, Routes, Route } from "react-router-dom";
import Onboarding from "./pages/Onboarding";
import Week from "./pages/Week";
import Settings from "./pages/Settings";
import Tasks from "./pages/Tasks";
import Reports from "./pages/Reports";
import Setup from "./pages/Setup";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Onboarding />} />
        <Route path="/day" element={<Week />} />
        <Route path="/week" element={<Week />} />
        <Route path="/month" element={<Week />} />
        <Route path="/year" element={<Week />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}
