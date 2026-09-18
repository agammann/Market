import { useEffect, useState, useRef } from "react";
import {
  Link,
  useParams,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { api, categories, assetLabels } from "./api";
import {
  Field,
  Notice,
  Busy,
  Empty,
  ProductRow,
  ActionForm,
  SearchIcon,
} from "./ui";
import { useSession } from "./main";

function FilterGroup({ title, options, value, onChange }) {
  return (
    <section className="filter-group">
      <h2>{title}</h2>
      {options.map(([key, label]) => (
        <button
          key={key}
          className={value === key ? "selected" : ""}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </section>
  );
}
export function Catalog() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get("q") || "");
  const [category, setCategory] = useState(params.get("category") || "");
  const query = params.toString();
  const set = (key, value) => {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    if (key !== "page") p.delete("page");
    setParams(p);
  };
  useEffect(() => {
    setSearch(params.get("q") || "");
    setCategory(params.get("category") || "");
  }, [query]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api("/listings?" + query)
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [query]);
  return (
    <>
      <div className="search-strip">
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            const p = new URLSearchParams(params);
            p.set("q", search);
            p.set("category", category);
            p.delete("page");
            setParams(p);
          }}
        >
          <div className="search-input">
            <SearchIcon />
            <input
              aria-label="Search products or sellers"
              placeholder="Search products or sellers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength="100"
            />
          </div>
          <select
            aria-label="Search category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button>Search</button>
        </form>
      </div>
      <main className="catalog">
        <aside className="sidebar" aria-label="Product filters">
          <FilterGroup
            title="Categories"
            value={params.get("category") || ""}
            onChange={(v) => set("category", v)}
            options={[["", "All products"], ...categories.map((c) => [c, c])]}
          />
          <FilterGroup
            title="Product type"
            value={params.get("kind") || ""}
            onChange={(v) => set("kind", v)}
            options={[
              ["", "Everything"],
              ["physical", "Physical goods"],
              ["digital", "Digital downloads"],
            ]}
          />
          <FilterGroup
            title="Payment asset"
            value={params.get("currency") || ""}
            onChange={(v) => set("currency", v)}
            options={[
              ["", "Any asset"],
              ...Object.entries(assetLabels).map(([key, label]) => [
                key,
                label + " · " + key,
              ]),
            ]}
          />
        </aside>
        <div className="catalog-body">
          <div className="catalog-heading">
            <div>
              <h1>Marketplace</h1>
              <p>
                Physical goods and digital downloads, direct from independent
                sellers.
              </p>
            </div>
            <select
              aria-label="Sort listings"
              value={params.get("sort") || "newest"}
              onChange={(e) => set("sort", e.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>{params.get("category") || "All products"}</h2>
              <span>
                {loading ? "Loading…" : `${data?.total || 0} listings`}
              </span>
            </div>
            {error ? (
              <div className="pad">
                <Notice error>{error}</Notice>
              </div>
            ) : loading ? (
              <div className="empty">
                <Busy />
              </div>
            ) : data?.items.length ? (
              <>
                {data.items.map((item) => (
                  <ProductRow item={item} key={item.id} />
                ))}
                <div className="pagination">
                  <button
                    className="secondary"
                    disabled={!data.page}
                    onClick={() => set("page", String(data.page - 1))}
                  >
                    Previous
                  </button>
                  <span>Page {data.page + 1}</span>
                  <button
                    className="secondary"
                    disabled={(data.page + 1) * 24 >= data.total}
                    onClick={() => set("page", String(data.page + 1))}
                  >
                    Next
                  </button>
                </div>
              </>
            ) : (
              <Empty title={query ? "No matching listings" : "No listings yet"}>
                <p>
                  {query
                    ? "Try a different search or clear your filters."
                    : "Be the first seller to bring something good to the market."}
                </p>
                {query ? (
                  <button onClick={() => setParams({})}>Clear filters</button>
                ) : (
                  <Link className="button" to="/sell/new">
                    Create a listing
                  </Link>
                )}
              </Empty>
            )}
          </section>
          <p className="payment-note">
            Payments go directly to sellers through BTCPay.
          </p>
        </div>
      </main>
    </>
  );
}
export function Listing() {
  const { id } = useParams();
  const { user } = useSession();
  const [l, setL] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const requestKey = useRef(
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  );
  useEffect(() => {
    api("/listings/" + id)
      .then(setL)
      .catch((e) => setError(e.message));
  }, [id]);
  if (error)
    return (
      <main className="page">
        <Notice error>{error}</Notice>
      </main>
    );
  if (!l)
    return (
      <main className="page">
        <Busy />
      </main>
    );
  return (
    <main className="page">
      <Link to="/">‹ Back to marketplace</Link>
      <div className="detail-grid">
        <section>
          <div className="detail-image">
            {l.image_id ? (
              <img src={"/media/" + l.image_id} alt={l.title} />
            ) : (
              <Empty title="No product image" />
            )}
          </div>
          <h2>About this product</h2>
          <p className="prewrap">{l.description}</p>
          {l.kind === "physical" && (
            <>
              <h2>Delivery</h2>
              <p>
                Ships to {l.ships_to}. Flat shipping per order: {l.shipping}{" "}
                {l.currency}.
              </p>
            </>
          )}
        </section>
        <section className="panel pad purchase">
          <span className="overline">
            {l.kind === "digital" ? "Digital download" : "Physical good"} ·{" "}
            {l.category}
          </span>
          <h1>{l.title}</h1>
          <p>
            Sold by <Link to={"/seller/" + l.seller_id}>{l.seller}</Link>
          </p>
          <p className="price">
            {l.price} {l.currency}
          </p>
          <p>{l.stock} available</p>
          {l.status !== "active" ? (
            <Notice>This listing is {l.status} and cannot be ordered.</Notice>
          ) : user?.id === l.seller_id ? (
            <Link className="button" to={"/sell/" + l.id + "/edit"}>
              Edit listing
            </Link>
          ) : !user ? (
            <Link
              className="button"
              to="/login"
              state={{ from: "/listing/" + l.id }}
            >
              Sign in to order
            </Link>
          ) : l.stock < 1 ? (
            <Notice>Out of stock</Notice>
          ) : (
            <ActionForm
              label="Create order"
              onSubmit={async (f) => {
                const result = await api("/orders", {
                  method: "POST",
                  body: {
                    listing_id: l.id,
                    quantity: Number(f.get("quantity") || 1),
                    address: f.get("address") || "",
                    request_key: requestKey.current,
                  },
                });
                navigate("/orders/" + result.id);
              }}
            >
              {l.kind === "physical" ? (
                <>
                  <Field
                    label="Quantity"
                    name="quantity"
                    type="number"
                    min="1"
                    max={Math.min(l.stock, 100)}
                    defaultValue="1"
                    required
                  />
                  <Field
                    label="Delivery name and address"
                    hint="Shared with the seller for this order."
                  >
                    <textarea
                      name="address"
                      required
                      minLength="10"
                      maxLength="2000"
                      rows="5"
                    />
                  </Field>
                </>
              ) : (
                <p>
                  Your file becomes available when BTCPay confirms invoice
                  settlement.
                </p>
              )}
              <label className="checkbox">
                <input type="checkbox" required />I understand payment goes
                directly to the seller and this marketplace does not provide
                escrow.
              </label>
            </ActionForm>
          )}
          <p className="muted small">
            Network: {assetLabels[l.currency]} mainnet. Order amounts are fixed
            in {l.currency}; no exchange rate is applied.
          </p>
        </section>
      </div>
      {user && (
        <details className="report">
          <summary>Report this listing</summary>
          <ActionForm
            label="Send report"
            onSubmit={async (f, form) => {
              await api("/listings/" + id + "/report", {
                method: "POST",
                body: { reason: f.get("reason") },
              });
              form.reset();
              return "Report sent to the operator.";
            }}
          >
            <Field label="Reason">
              <textarea
                name="reason"
                required
                minLength="10"
                maxLength="2000"
              />
            </Field>
          </ActionForm>
        </details>
      )}
    </main>
  );
}
export function SellerProfile() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/sellers/" + id)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <main className="page">
      {error ? (
        <Notice error>{error}</Notice>
      ) : !data ? (
        <Busy />
      ) : (
        <>
          <span className="overline">Seller profile</span>
          <h1>{data.seller.username}</h1>
          <p className="prewrap">
            {data.seller.bio || "This seller has not added a profile yet."}
          </p>
          <h2>Listings</h2>
          <section className="panel">
            {data.listings.length ? (
              data.listings.map((l) => <ProductRow key={l.id} item={l} />)
            ) : (
              <p className="pad">No published listings.</p>
            )}
          </section>
          <h2>Buyer feedback</h2>
          <p className="muted">Feedback comes from fulfilled orders.</p>
          {data.reviews.length ? (
            data.reviews.map((r, i) => (
              <article className="review" key={i}>
                <strong>
                  {r.rating}/5 · {r.username}
                </strong>
                <p>{r.body}</p>
              </article>
            ))
          ) : (
            <p>No feedback yet.</p>
          )}
        </>
      )}
    </main>
  );
}
