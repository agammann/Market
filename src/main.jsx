import React, { useEffect, useState, createContext, useContext } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  useNavigate,
  Navigate,
  useLocation,
} from "react-router-dom";
import { api } from "./api";
import { Busy, Notice } from "./ui";
import { Catalog, Listing, SellerProfile } from "./shop";
import { Auth, Account, Sell, ListingEditor, Admin } from "./seller";
import { Orders, OrderDetail } from "./orders";
import "./style.css";
const Session = createContext(null);
export const useSession = () => useContext(Session);
function Guard({ children }) {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) return <Busy />;
  return user ? (
    children
  ) : (
    <Navigate to="/login" state={{ from: location.pathname }} replace />
  );
}
class ErrorBoundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="page">
        <Notice error>
          Something went wrong displaying this page. Reload to try again.
        </Notice>
        <a href="/">Return to marketplace</a>
      </main>
    ) : (
      this.props.children
    );
  }
}
function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    api("/session")
      .then((data) => setUser(data.user))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <Session.Provider value={{ user, setUser, loading }}>
      <header className="masthead">
        <div className="header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" />
            Market
          </Link>
          <nav aria-label="Main navigation">
            <NavLink to="/" end>
              Browse
            </NavLink>
            <NavLink to="/orders">Orders</NavLink>
            <NavLink to="/sell">Sell</NavLink>
            <NavLink to="/account">Account</NavLink>
            {user?.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          {user ? (
            <button
              className="header-action"
              onClick={async () => {
                try {
                  await api("/logout", { method: "POST" });
                  setUser(null);
                  navigate("/");
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Sign out
            </button>
          ) : (
            <Link to="/login" className="button header-action">
              Sign in
            </Link>
          )}
        </div>
      </header>
      {error && (
        <div className="page">
          <Notice error>{error}</Notice>
        </div>
      )}
      <Routes>
        <Route
          path="/privacy"
          element={
            <main className="page">
              <section className="panel pad">
                <h1>Privacy and payments</h1>
                <p>
                  You can browse without an account. Accounts use a username and
                  password, with no email address required. The marketplace has
                  no analytics, advertising trackers, or externally hosted page
                  assets.
                </p>
                <h2>What your order shares</h2>
                <p>
                  Your seller sees your order and any delivery details you
                  provide. Digital purchases do not need a delivery address.
                  Private messages, shipping addresses, and tracking details are
                  encrypted in the database and available through the app only
                  to the buyer and seller. The server can decrypt these fields;
                  this is not end to end encryption.
                </p>
                <p>
                  Order records and messages are retained. There is currently no
                  automatic deletion or account recovery. Keep your password
                  safe and share only the details needed to complete the order.
                </p>
                <h2>Bitcoin and Monero</h2>
                <p>
                  Payments go to each seller through their BTCPay instance.
                  Bitcoin uses a public transaction ledger. Choosing Monero or
                  using Tor does not guarantee anonymity. BTCPay receives an
                  order reference, currency, and amount; the marketplace does
                  not send your username, messages, or delivery address to it.
                </p>
                <p>
                  There is no marketplace escrow. Downloads become available
                  after the payment provider reports settlement. Refunds are
                  handled by the seller, and a recorded refund is a seller
                  statement rather than independent verification.
                </p>
                <h2>Your browser and device</h2>
                <p>
                  This interface needs JavaScript. Your browser, wallet,
                  operating system, seller, delivery carrier, and server
                  operator can affect your privacy. A Tor connection does not
                  protect a compromised device.
                </p>
              </section>
            </main>
          }
        />
        <Route path="/" element={<Catalog />} />
        <Route path="/listing/:id" element={<Listing />} />
        <Route path="/seller/:id" element={<SellerProfile />} />
        <Route path="/login" element={<Auth />} />
        <Route
          path="/account"
          element={
            <Guard>
              <Account />
            </Guard>
          }
        />
        <Route
          path="/sell"
          element={
            <Guard>
              <Sell />
            </Guard>
          }
        />
        <Route
          path="/sell/new"
          element={
            <Guard>
              <ListingEditor />
            </Guard>
          }
        />
        <Route
          path="/sell/:id/edit"
          element={
            <Guard>
              <ListingEditor />
            </Guard>
          }
        />
        <Route
          path="/orders"
          element={
            <Guard>
              <Orders />
            </Guard>
          }
        />
        <Route
          path="/orders/:id"
          element={
            <Guard>
              <OrderDetail />
            </Guard>
          }
        />
        <Route
          path="/admin"
          element={
            <Guard>
              <Admin />
            </Guard>
          }
        />
        <Route
          path="*"
          element={
            <main className="page">
              <h1>Page not found</h1>
              <Link to="/">Browse the marketplace</Link>
            </main>
          }
        />
      </Routes>
      <footer className="footer">
        <Link to="/" className="brand">
          <span className="brand-mark" />
          Market
        </Link>
        <p>Independent sellers. Direct exchange.</p>
        <Link to="/privacy">Privacy and payments</Link>
      </footer>
    </Session.Provider>
  );
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ErrorBoundary>,
);
