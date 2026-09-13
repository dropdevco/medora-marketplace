import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/layout/Navbar';
import { SearchPage } from './pages/SearchPage';
import { PricingPage } from './pages/PricingPage';
import { LoginPage } from './pages/LoginPage';
import { ClaimPage } from './pages/ClaimPage';
import { DashboardPage } from './pages/DashboardPage';
import './index.css';

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/claim/:providerId" element={<ClaimPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        {/*
          /sales was the clinic-facing page and is now /pricing. The old path
          is in sent emails and in the lead rows, so it redirects rather than
          404s — and it replaces the history entry, so Back from /pricing goes
          where the user came from instead of bouncing through the redirect.
        */}
        <Route path="/sales" element={<Navigate to="/pricing" replace />} />
        {/* Anything else is a mistyped or stale link; the directory is the
            only sensible place to land. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
