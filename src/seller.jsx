import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation, useParams } from "react-router-dom";
import { api, upload, categories, assetLabels, statusLabel } from "./api";
import { Field, Notice, Busy, ActionForm, Empty } from "./ui";
import { useSession } from "./main";

export function Auth() {
  const [register, setRegister] = useState(false);
  const { setUser } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <main className="page narrow">
      <div className="panel pad">
        <h1>{register ? "Create your account" : "Welcome back"}</h1>
        <p>
          {register
            ? "One account to buy, sell and manage your orders."
            : "Sign in to your marketplace account."}
        </p>
        <ActionForm
          label={register ? "Create account" : "Sign in"}
          key={String(register)}
          onSubmit={async (f) => {
            const result = await api(register ? "/register" : "/login", {
              method: "POST",
              body: {
                username: f.get("username"),
                password: f.get("password"),
              },
            });
            setUser(result.user);
            navigate(location.state?.from || "/account", { replace: true });
          }}
        >
          <Field
            label="Username"
            name="username"
            required
            minLength="3"
            maxLength="32"
            pattern="[A-Za-z0-9_]+"
            autoComplete="username"
          />
          <Field
            label="Password"
            name="password"
            type="password"
            required
            minLength={register ? 12 : 1}
            maxLength="128"
            autoComplete={register ? "new-password" : "current-password"}
            hint={
              register
                ? "Use at least 12 characters. Store your password safely; email recovery is not configured."
                : undefined
            }
          />
        </ActionForm>
        <button className="text-button" onClick={() => setRegister(!register)}>
          {register
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
      </div>
    </main>
  );
}
export function Account() {
  const { user, setUser } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const reload = () => api("/account").then(setData);
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  return (
    <main className="page">
      <h1>Your account</h1>
      <p className="muted">Signed in as {user.username}</p>
      {error && <Notice error>{error}</Notice>}
      <div className="two-columns">
        <section className="panel pad">
          <h2>Seller profile</h2>
          {data ? (
            <ActionForm
              onSubmit={async (f) => {
                await api("/account", {
                  method: "PATCH",
                  body: { bio: f.get("bio") },
                });
                return "Profile saved.";
              }}
            >
              <Field label="About your shop">
                <textarea
                  name="bio"
                  defaultValue={data.user.bio}
                  maxLength="1500"
                  rows="5"
                />
              </Field>
            </ActionForm>
          ) : (
            <Busy />
          )}
          <Link to={"/seller/" + user.id}>View public profile</Link>
        </section>
        <section className="panel pad">
          <h2>BTCPay connection</h2>
          <p>
            Each seller connects their own BTCPay Server with Bitcoin and the
            Monero plugin.
          </p>
          {data?.payment.connected ? (
            <>
              <Notice>
                Connected for {data.payment.assets.join(" and ")}.
              </Notice>
              <p className="break">{data.payment.url}</p>
            </>
          ) : (
            <Notice>
              Your BTCPay instance is not connected yet. Contact the marketplace
              operator to enroll your store through the private server
              configuration.
            </Notice>
          )}
          <p className="small">
            The integration needs invoice creation and read permissions only.
            Never share wallet seed phrases or spending keys. Products can be
            drafted now; ordering stays disabled until the connection is
            configured.
          </p>
        </section>
        <section className="panel pad">
          <h2>Change password</h2>
          <ActionForm
            label="Update password"
            onSubmit={async (f, form) => {
              const r = await api("/account/password", {
                method: "POST",
                body: {
                  currentPassword: f.get("current"),
                  password: f.get("password"),
                },
              });
              setUser(r.user);
              form.reset();
              return "Password changed. Other sessions have been signed out.";
            }}
          >
            <Field
              label="Current password"
              name="current"
              type="password"
              autoComplete="current-password"
              required
            />
            <Field
              label="New password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength="12"
              maxLength="128"
            />
          </ActionForm>
        </section>
      </div>
    </main>
  );
}
export function Sell() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const reload = () => api("/seller/listings").then(setItems);
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Seller workspace</h1>
          <p>Create products, manage inventory and fulfill your orders.</p>
        </div>
        <Link to="/sell/new" className="button">
          Create a listing
        </Link>
      </div>
      <p className="notice">
        Check your BTCPay connection in <Link to="/account">Account</Link>. New
        and edited listings are reviewed by the operator.
      </p>
      {error && <Notice error>{error}</Notice>}
      <section className="panel">
        {!items ? (
          <div className="pad">
            <Busy />
          </div>
        ) : items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Available</th>
                  <th>Status</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link to={"/listing/" + l.id}>{l.title}</Link>
                      <small>{l.kind}</small>
                    </td>
                    <td>
                      {l.price} {l.currency}
                    </td>
                    <td>{l.stock}</td>
                    <td>
                      <span className="status">{statusLabel(l.status)}</span>
                    </td>
                    <td>
                      <Link to={"/sell/" + l.id + "/edit"}>Edit</Link>
                      {l.status === "active" && (
                        <button
                          className="text-button"
                          onClick={async () => {
                            try {
                              await api("/listings/" + l.id, {
                                method: "PATCH",
                                body: { action: "pause" },
                              });
                              await reload();
                            } catch (e) {
                              setError(e.message);
                            }
                          }}
                        >
                          Pause
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Your shop starts here">
            <p>Create a listing for a physical product or a digital file.</p>
          </Empty>
        )}
      </section>
    </main>
  );
}
export function ListingEditor() {
  const { id } = useParams();
  const [data, setData] = useState(id ? null : {});
  const [kind, setKind] = useState("physical");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    if (id)
      api("/listings/" + id)
        .then((d) => {
          setData(d);
          setKind(d.kind);
        })
        .catch((e) => setError(e.message));
  }, [id]);
  return (
    <main className="page form-page">
      <Link to="/sell">‹ Seller workspace</Link>
      <h1>{id ? "Edit listing" : "Create a listing"}</h1>
      <p>
        Describe what you sell, set the exact crypto price and choose how it is
        delivered.
      </p>
      {error ? (
        <Notice error>{error}</Notice>
      ) : !data ? (
        <Busy />
      ) : (
        <section className="panel pad">
          <ActionForm
            label={id ? "Save and submit for review" : "Submit for review"}
            onSubmit={async (f) => {
              let imageId = data.image_id || null,
                fileId = null;
              const image = f.get("image"),
                file = f.get("file");
              if (image?.size) imageId = (await upload(image, "image")).id;
              if (file?.size) fileId = (await upload(file, "digital")).id;
              const body = {
                title: f.get("title"),
                description: f.get("description"),
                kind,
                category: f.get("category"),
                currency: f.get("currency"),
                price: f.get("price"),
                shipping: f.get("shipping") || "0",
                ships_to: f.get("ships_to") || "",
                stock: Number(f.get("stock")),
                image_id: imageId,
                ...(fileId ? { file_id: fileId } : {}),
              };
              await api("/listings" + (id ? "/" + id : ""), {
                method: id ? "PATCH" : "POST",
                body,
              });
              navigate("/sell");
            }}
          >
            <div className="two-columns">
              <Field label="Product type">
                <select
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="physical">Physical good</option>
                  <option value="digital">Digital download</option>
                </select>
              </Field>
              <Field label="Category">
                <select name="category" defaultValue={data.category || "Other"}>
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label="Product title"
              name="title"
              defaultValue={data.title}
              required
              minLength="3"
              maxLength="120"
            />
            <Field
              label="Description"
              hint="Include dimensions, contents, license terms or returns information as appropriate."
            >
              <textarea
                name="description"
                defaultValue={data.description}
                required
                minLength="10"
                maxLength="10000"
                rows="6"
              />
            </Field>
            <div className="three-columns">
              <Field label="Payment asset">
                <select name="currency" defaultValue={data.currency || "BTC"}>
                  {Object.keys(assetLabels).map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="Exact price per item"
                name="price"
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]+)?"
                defaultValue={data.price}
                required
                placeholder="0.001"
              />
              <Field
                label="Available quantity"
                name="stock"
                type="number"
                min="0"
                max="100000"
                defaultValue={data.stock ?? 1}
                required
              />
            </div>
            {kind === "physical" ? (
              <div className="two-columns">
                <Field
                  label="Flat shipping per order"
                  name="shipping"
                  inputMode="decimal"
                  defaultValue={data.shipping || "0"}
                  required
                  hint="In the same asset as the price."
                />
                <Field
                  label="Ships to"
                  name="ships_to"
                  defaultValue={data.ships_to}
                  required
                  minLength="2"
                  maxLength="300"
                  placeholder="Countries or regions you deliver to"
                />
              </div>
            ) : (
              <Field
                label="Digital product file"
                name="file"
                type="file"
                required={!id || data.kind !== "digital"}
                hint={
                  id
                    ? "Upload a replacement or keep the current file. Maximum 50 MB. Existing orders retain their original file."
                    : "Maximum 50 MB. Only paid buyers can download it."
                }
              />
            )}
            <Field
              label="Product image (optional)"
              name="image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hint="JPEG, PNG or WebP, up to 8 MB. Photos are resized and metadata is removed."
            />
            <label className="checkbox">
              <input type="checkbox" required />I have the right to sell this
              product and distribute its content.
            </label>
          </ActionForm>
        </section>
      )}
    </main>
  );
}
export function Admin() {
  const { user } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const reload = () => api("/admin").then(setData);
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  const moderate = async (id, status) => {
    try {
      await api("/admin/listings/" + id, { method: "POST", body: { status } });
      await reload();
    } catch (e) {
      setError(e.message);
    }
  };
  if (user.role !== "admin")
    return (
      <main className="page">
        <Notice error>Administrator access required.</Notice>
      </main>
    );
  return (
    <main className="page">
      <h1>Marketplace administration</h1>
      <p>Review listings and respond to reports.</p>
      {error && <Notice error>{error}</Notice>}
      {!data ? (
        <Busy />
      ) : (
        <>
          <h2>Listings</h2>
          <section className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Seller</th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {data.listings.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link to={"/listing/" + l.id}>{l.title}</Link>
                    </td>
                    <td>{l.seller}</td>
                    <td>{statusLabel(l.status)}</td>
                    <td>
                      <div className="actions">
                        <button onClick={() => moderate(l.id, "active")}>
                          Approve
                        </button>
                        <button
                          className="secondary"
                          onClick={() => moderate(l.id, "rejected")}
                        >
                          Reject
                        </button>
                        <button
                          className="secondary"
                          onClick={() => moderate(l.id, "paused")}
                        >
                          Pause
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.listings.length && (
              <p className="pad">No listings to review.</p>
            )}
          </section>
          <h2>Open reports</h2>
          {data.reports.length ? (
            data.reports.map((r) => (
              <section className="panel pad" key={r.id}>
                <h3>{r.title}</h3>
                <p className="prewrap">{r.reason}</p>
                <div className="actions">
                  <button onClick={() => moderate(r.listing_id, "paused")}>
                    Pause listing
                  </button>
                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        await api("/admin/reports/" + r.id, { method: "POST" });
                        await reload();
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Close report
                  </button>
                </div>
              </section>
            ))
          ) : (
            <p>No open reports.</p>
          )}
        </>
      )}
    </main>
  );
}
