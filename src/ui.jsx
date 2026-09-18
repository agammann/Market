import { useState } from "react";
import { Link } from "react-router-dom";
export function Field({ label, children, hint, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input {...props} />} {hint && <small>{hint}</small>}
    </label>
  );
}
export function Notice({ error, children }) {
  return (
    <div
      className={"notice " + (error ? "error" : "")}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Bag() {
  return (
    <svg
      className="bag"
      viewBox="0 0 64 76"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 24h48l5 47H3z" />
      <path d="M20 30V16a12 12 0 0 1 24 0v14" strokeLinecap="round" />
    </svg>
  );
}
export function SearchIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6" />
    </svg>
  );
}
export function Busy({ children = "Loading…" }) {
  return (
    <p role="status" className="muted">
      {children}
    </p>
  );
}
export function Empty({ title, children }) {
  return (
    <div className="empty">
      <Bag />
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function ProductRow({ item }) {
  return (
    <article className="product-row">
      {item.image_id ? (
        <Link to={"/listing/" + item.id}>
          <img
            src={"/media/" + item.image_id}
            alt={item.title}
            loading="lazy"
          />
        </Link>
      ) : (
        <div className="product-placeholder">
          <Bag />
        </div>
      )}
      <div className="product-description">
        <span className="overline">
          {item.kind === "digital" ? "Digital download" : "Physical good"} ·{" "}
          {item.category}
        </span>
        <h2>
          <Link to={"/listing/" + item.id}>{item.title}</Link>
        </h2>
        <p>
          Sold by <Link to={"/seller/" + item.seller_id}>{item.seller}</Link>
        </p>
        <small>
          {item.kind === "physical"
            ? "Ships to " + item.ships_to
            : "Download after payment confirmation"}
        </small>
      </div>
      <div className="product-price">
        <strong>
          {item.price} {item.currency}
        </strong>
        <small>
          {item.stock > 0 ? `${item.stock} available` : "Out of stock"}
        </small>
        <Link className="button secondary" to={"/listing/" + item.id}>
          View product
        </Link>
      </div>
    </article>
  );
}
export function ActionForm({
  onSubmit,
  children,
  label = "Save",
  className = "",
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  return (
    <form
      className={"form " + className}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = e.currentTarget;
        setBusy(true);
        setError("");
        setSuccess("");
        try {
          const result = await onSubmit(new FormData(form), form);
          if (result) setSuccess(result);
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && <Notice error>{error}</Notice>}
      {success && <Notice>{success}</Notice>}
      <button disabled={busy} type="submit">
        {busy ? "Working…" : label}
      </button>
    </form>
  );
}
