import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, statusLabel, assetLabels } from "./api";
import { ActionForm, Field, Notice, Busy, Empty } from "./ui";
import { useSession } from "./main";
export function Orders() {
  const { user } = useSession();
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("buying");
  useEffect(() => {
    api("/orders")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);
  const filtered = items?.filter((o) =>
    view === "buying" ? o.buyer_id === user.id : o.seller_id === user.id,
  );
  return (
    <main className="page">
      <h1>Your orders</h1>
      <div className="tabs">
        <button
          className={view === "buying" ? "" : "secondary"}
          onClick={() => setView("buying")}
        >
          Purchases
        </button>
        <button
          className={view === "selling" ? "" : "secondary"}
          onClick={() => setView("selling")}
        >
          Sales
        </button>
      </div>
      {error ? (
        <Notice error>{error}</Notice>
      ) : !items ? (
        <Busy />
      ) : (
        <section className="panel">
          {filtered.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>{view === "buying" ? "Seller" : "Buyer"}</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link to={"/orders/" + o.id}>{o.title}</Link>
                        <small>
                          {new Date(o.created_at).toLocaleDateString()} · Qty{" "}
                          {o.quantity}
                        </small>
                      </td>
                      <td>{view === "buying" ? o.seller : o.buyer}</td>
                      <td>
                        {o.total} {o.currency}
                      </td>
                      <td>{statusLabel(o.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={view === "buying" ? "No purchases yet" : "No sales yet"}
            >
              <p>
                {view === "buying"
                  ? "Find your next good thing in the marketplace."
                  : "Your incoming orders will appear here."}
              </p>
              <Link className="button" to={view === "buying" ? "/" : "/sell"}>
                {view === "buying" ? "Browse products" : "Manage listings"}
              </Link>
            </Empty>
          )}
        </section>
      )}
    </main>
  );
}
export function OrderDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const reload = () => api("/orders/" + id).then(setData);
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [id]);
  if (error)
    return (
      <main className="page">
        <Notice error>{error}</Notice>
      </main>
    );
  if (!data)
    return (
      <main className="page">
        <Busy />
      </main>
    );
  const o = data.order;
  const buyer = o.buyer_id === user.id;
  const action = async (name, body = {}) => {
    await api("/orders/" + id + "/action", {
      method: "POST",
      body: { action: name, ...body },
    });
    await reload();
  };
  return (
    <main className="page">
      <Link to="/orders">‹ All orders</Link>
      <div className="page-heading">
        <div>
          <h1>{o.title}</h1>
          <p>
            Order <code>{o.id.slice(0, 8)}</code> ·{" "}
            {buyer ? "Seller: " + o.seller : "Buyer: " + o.buyer}
          </p>
        </div>
        <span className="status">{statusLabel(o.status)}</span>
      </div>
      <div className="two-columns">
        <section className="panel pad">
          <h2>Order details</h2>
          <dl>
            <dt>Product type</dt>
            <dd>
              {o.kind === "digital" ? "Digital download" : "Physical good"}
            </dd>
            <dt>Quantity</dt>
            <dd>{o.quantity}</dd>
            <dt>Item price</dt>
            <dd>
              {o.unit_price} {o.currency}
            </dd>
            <dt>Shipping</dt>
            <dd>
              {o.shipping} {o.currency}
            </dd>
            <dt>Total</dt>
            <dd>
              <strong>
                {o.total} {o.currency}
              </strong>
            </dd>
            <dt>Created</dt>
            <dd>{new Date(o.created_at).toLocaleString()}</dd>
          </dl>
          {o.address && (
            <>
              <h3>Delivery address</h3>
              <p className="prewrap">{o.address}</p>
            </>
          )}
          {o.tracking && (
            <>
              <h3>Shipping details</h3>
              <p>{o.tracking}</p>
            </>
          )}
          {o.kind === "digital" && o.status === "fulfilled" && buyer && (
            <a className="button" href={"/api/orders/" + id + "/download"}>
              Download purchase
            </a>
          )}
        </section>
        <section className="panel pad">
          <h2>Payment & fulfillment</h2>
          <p>
            Payment goes directly to the seller through BTCPay. The marketplace
            does not hold funds or provide escrow.
          </p>
          {[
            "awaiting_invoice",
            "awaiting_payment",
            "confirming",
            "payment_review",
          ].includes(o.status) && (
            <>
              <p>
                <strong>
                  Order amount: {o.total} {o.currency}
                </strong>
                <br />
                {assetLabels[o.currency]}. Confirm the network on the seller's
                BTCPay invoice before paying.
              </p>
              {data.payment ? (
                <a
                  className="button"
                  href={data.payment.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open BTCPay invoice
                </a>
              ) : (
                <Notice>
                  The invoice is being prepared. If this does not resolve,
                  contact the seller in the order conversation. Do not send
                  payment without an invoice.
                </Notice>
              )}
              <ActionForm
                label="Check payment status"
                onSubmit={async () => {
                  await api("/orders/" + id + "/refresh", { method: "POST" });
                  await reload();
                  return "Payment status checked.";
                }}
              />
              <p className="small">
                Follow the exact amount and expiry shown on the BTCPay invoice.
                Network fees may apply. A payment must reach the required
                confirmations before fulfillment.
              </p>
            </>
          )}
          {o.status === "payment_review" && (
            <Notice>
              The invoice expired, was marked invalid, or needs review. Contact
              the seller before sending anything further. Inventory remains
              reserved while this is resolved.
            </Notice>
          )}
          {o.status === "paid" && !buyer && (
            <ActionForm
              label="Mark shipped"
              onSubmit={async (f) =>
                action("ship", { tracking: f.get("tracking") })
              }
            >
              <Field
                label="Carrier and tracking or delivery note"
                name="tracking"
                minLength="3"
                maxLength="300"
                required
              />
            </ActionForm>
          )}
          {o.status === "shipped" && buyer && (
            <ActionForm
              label="Confirm delivery received"
              onSubmit={async () => action("complete")}
            >
              <p>Confirm when the physical product has arrived.</p>
            </ActionForm>
          )}
          {["paid", "shipped", "fulfilled"].includes(o.status) && !buyer && (
            <details>
              <summary>Record a completed refund</summary>
              <p>
                This records a refund you already sent from your wallet. It does
                not transfer funds.
              </p>
              <ActionForm
                label="Record refund"
                onSubmit={async (f) =>
                  action("record_refund", { reference: f.get("reference") })
                }
              >
                <Field
                  label="Refund transaction reference"
                  name="reference"
                  minLength="16"
                  maxLength="200"
                  required
                />
                <label className="checkbox">
                  <input type="checkbox" required />I have sent the refund.
                  Download access will be revoked.
                </label>
              </ActionForm>
            </details>
          )}
        </section>
        <section className="panel pad">
          <h2>Order conversation</h2>
          <div className="messages">
            {data.messages.length ? (
              data.messages.map((m) => (
                <article key={m.id} className="message">
                  <strong>{m.username}</strong>
                  <small>{new Date(m.created_at).toLocaleString()}</small>
                  <p className="prewrap">{m.body}</p>
                </article>
              ))
            ) : (
              <p className="muted">
                No messages yet. Keep payment and fulfillment questions with
                this order.
              </p>
            )}
          </div>
          <ActionForm
            label="Send message"
            onSubmit={async (f, form) => {
              await api("/orders/" + id + "/messages", {
                method: "POST",
                body: { body: f.get("body") },
              });
              form.reset();
              await reload();
            }}
          >
            <Field label="Message">
              <textarea name="body" required maxLength="4000" rows="3" />
            </Field>
          </ActionForm>
        </section>
        {buyer && o.status === "fulfilled" && (
          <section className="panel pad">
            <h2>Buyer feedback</h2>
            {data.review ? (
              <>
                <strong>{data.review.rating}/5</strong>
                <p>{data.review.body}</p>
              </>
            ) : (
              <ActionForm
                label="Publish review"
                onSubmit={async (f) => {
                  await api("/orders/" + id + "/review", {
                    method: "POST",
                    body: {
                      rating: Number(f.get("rating")),
                      body: f.get("body"),
                    },
                  });
                  await reload();
                }}
              >
                <Field label="Rating">
                  <select name="rating">
                    {[5, 4, 3, 2, 1].map((v) => (
                      <option key={v} value={v}>
                        {v} out of 5
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Your experience">
                  <textarea
                    name="body"
                    required
                    minLength="5"
                    maxLength="2000"
                  />
                </Field>
              </ActionForm>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
