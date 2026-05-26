import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Upgrade() {
  const plans = [
    {
      name: "Free",
      price: "$0",
      desc: "Perfect for testing or small catalogs",
      features: [
        "Up to 200 Products indexed",
        "4 Standard Filter options",
        "Standard styling",
        "Daily auto-sync",
      ],
      current: true,
      buttonText: "Current Plan",
    },
    {
      name: "Growth",
      price: "$9.90",
      period: "/month",
      desc: "Best for growing medium stores",
      features: [
        "Up to 2,000 Products indexed",
        "Unlimited Custom options",
        "Color swatches styling",
        "Hourly auto-sync",
        "Standard support",
      ],
      current: false,
      buttonText: "Upgrade to Growth",
    },
    {
      name: "Professional",
      price: "$29.90",
      period: "/month",
      desc: "Advanced searching and scale",
      features: [
        "Unlimited Products indexed",
        "Everything in Growth plan",
        "Collection Merchandising",
        "Instant Search Autocomplete",
        "Priority 24/7 Support",
      ],
      current: false,
      buttonText: "Upgrade to Pro",
    }
  ];

  return (
    <s-page heading="Pricing Plans">
      <ui-title-bar title="Pricing Plans"></ui-title-bar>
      <s-stack direction="block" gap="base">
        <s-box padding="base" background="info" borderRadius="base">
          <s-paragraph>
            Choose a plan that fits your business scale. You can upgrade, downgrade, or cancel at any time directly through your Shopify bill.
          </s-paragraph>
        </s-box>

        <div style={{ display: "flex", gap: "24px", marginTop: "16px" }}>
          {plans.map((plan) => (
            <s-box
              key={plan.name}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
              style={{
                flex: 1,
                backgroundColor: "#white",
                border: plan.current ? "2px solid #008060" : "1px solid #e1e3e5",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "24px",
                borderRadius: "12px",
                background: "white"
              }}
            >
              {plan.current && (
                <span
                  style={{
                    position: "absolute",
                    top: "-12px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "#008060",
                    color: "#fff",
                    padding: "4px 12px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: "600",
                  }}
                >
                  ACTIVE
                </span>
              )}

              <div>
                <s-text variant="headingLg" fontWeight="bold">
                  {plan.name}
                </s-text>
                <div style={{ margin: "16px 0 8px" }}>
                  <span style={{ fontSize: "36px", fontWeight: "700", color: "#202223" }}>{plan.price}</span>
                  {plan.period && <span style={{ color: "#6d7175", fontSize: "14px" }}>{plan.period}</span>}
                </div>
                <s-paragraph style={{ color: "#6d7175", fontSize: "13px", marginBottom: "20px" }}>
                  {plan.desc}
                </s-paragraph>

                <hr style={{ border: 0, borderTop: "1px solid #e1e3e5", margin: "20px 0" }} />

                <ul style={{ paddingLeft: "20px", margin: 0, fontSize: "14px", color: "#4a4c4e", lineHeight: "2" }}>
                  {plan.features.map((feat) => (
                    <li key={feat}>{feat}</li>
                  ))}
                </ul>
              </div>

              <div style={{ marginTop: "32px" }}>
                <button
                  disabled={plan.current}
                  onClick={() => alert(`Upgrading to ${plan.name} plan...`)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "6px",
                    border: plan.current ? "1px solid #ccc" : "none",
                    background: plan.current ? "#f1f2f4" : "#008060",
                    color: plan.current ? "#6d7175" : "#fff",
                    fontWeight: "600",
                    fontSize: "14px",
                    cursor: plan.current ? "default" : "pointer",
                  }}
                >
                  {plan.buttonText}
                </button>
              </div>
            </s-box>
          ))}
        </div>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
