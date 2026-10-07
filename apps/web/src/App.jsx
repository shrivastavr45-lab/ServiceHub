import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireRole } from './auth.jsx';
import { DashboardLayout, PublicLayout } from './components/Layout.jsx';
import { Landing, Categories, ProviderSearch, ProviderProfile, Login, Register, NotFound } from './pages/public.jsx';
import { Notifications, BookingDetail, BookingList, InvoiceList, InvoiceView, Profile } from './pages/shared.jsx';
import { CustomerDashboard, NewRequest, CustomerPayments, CustomerReviews } from './pages/customer.jsx';
import { ProviderDashboard, ProviderServices, Availability, Earnings, ProviderReviews } from './pages/provider.jsx';
import * as A from './pages/admin.jsx';

const REQ = ['REQUESTED'];
const QUOTES = ['QUOTED', 'NEGOTIATING'];
const BOOKINGS = ['ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED', 'CANCELLED'];

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/providers" element={<ProviderSearch />} />
        <Route path="/providers/:id" element={<ProviderProfile />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="/customer" element={<RequireRole role="CUSTOMER"><DashboardLayout /></RequireRole>}>
        <Route index element={<CustomerDashboard />} />
        <Route path="requests" element={<BookingList title="My requests" subtitle="Requests waiting for a provider's response" statuses={REQ} />} />
        <Route path="quotations" element={<BookingList title="Quotations & negotiation" subtitle="Review quotes, counter-offer or accept" statuses={QUOTES} />} />
        <Route path="bookings" element={<BookingList title="Bookings" subtitle="Accepted, scheduled and past jobs" statuses={BOOKINGS} />} />
        <Route path="bookings/:id" element={<BookingDetail />} />
        <Route path="new-request/:providerServiceId" element={<NewRequest />} />
        <Route path="invoices" element={<InvoiceList />} />
        <Route path="invoices/:id" element={<InvoiceView />} />
        <Route path="payments" element={<CustomerPayments />} />
        <Route path="reviews" element={<CustomerReviews />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="/provider" element={<RequireRole role="SERVICE_PROVIDER"><DashboardLayout /></RequireRole>}>
        <Route index element={<ProviderDashboard />} />
        <Route path="requests" element={<BookingList title="Service requests" subtitle="New requests awaiting your quotation" statuses={REQ} />} />
        <Route path="quotations" element={<BookingList title="Quotations & negotiation" subtitle="Open price discussions" statuses={QUOTES} />} />
        <Route path="bookings" element={<BookingList title="Bookings" subtitle="Upcoming, in-progress and completed jobs" statuses={BOOKINGS} />} />
        <Route path="bookings/:id" element={<BookingDetail />} />
        <Route path="services" element={<ProviderServices />} />
        <Route path="availability" element={<Availability />} />
        <Route path="earnings" element={<Earnings />} />
        <Route path="invoices" element={<InvoiceList />} />
        <Route path="invoices/:id" element={<InvoiceView />} />
        <Route path="reviews" element={<ProviderReviews />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="/admin" element={<RequireRole role="ADMIN"><DashboardLayout /></RequireRole>}>
        <Route index element={<A.AdminDashboard />} />
        <Route path="customers" element={<A.Users role="CUSTOMER" />} />
        <Route path="providers" element={<A.Users role="SERVICE_PROVIDER" />} />
        <Route path="categories" element={<A.Categories />} />
        <Route path="services" element={<A.Services />} />
        <Route path="bookings" element={<A.Bookings />} />
        <Route path="bookings/:id" element={<BookingDetail />} />
        <Route path="disputes" element={<A.Disputes />} />
        <Route path="reviews" element={<A.Reviews />} />
        <Route path="reports" element={<A.Reports />} />
        <Route path="audit-logs" element={<A.AuditLogs />} />
        <Route path="settings" element={<A.Settings />} />
      </Route>
      <Route path="/home" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
