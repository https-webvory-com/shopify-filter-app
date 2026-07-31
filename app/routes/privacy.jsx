import React from "react";

export const meta = () => {
  return [
    { title: "Privacy Policy - AI Search & Filter" },
    { name: "description", content: "Privacy Policy for AI Search & Filter Shopify Application by webvort" },
  ];
};

export default function PrivacyPolicy() {
  return (
    <div style={styles.pageContainer}>
      <div style={styles.headerBanner}>
        <div style={styles.headerContent}>
          <div style={styles.badge}>AI Search & Filter</div>
          <h1 style={styles.mainTitle}>Privacy Policy</h1>
          <p style={styles.effectiveDate}>Effective Date: July 31, 2026</p>
        </div>
      </div>

      <main style={styles.mainContainer}>
        <div style={styles.card}>
          <p style={styles.introText}>
            Thank you for using <strong>AI Search & Filter</strong> ("the App"). This Privacy Policy explains how we collect, use, disclose, and protect information when merchants install and use our Shopify application.
          </p>

          {/* Section 1 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>1. Information We Collect</h2>
            <p style={styles.paragraph}>
              When you install and use the App, we may collect information necessary to provide our services, including:
            </p>

            <div style={styles.subBlock}>
              <h3 style={styles.subTitle}>Store Information</h3>
              <ul style={styles.list}>
                <li>Shopify store name</li>
                <li>Shop domain</li>
                <li>Shop ID</li>
                <li>Store locale and timezone</li>
                <li>Store currency</li>
                <li>Shopify plan information</li>
              </ul>
            </div>

            <div style={styles.subBlock}>
              <h3 style={styles.subTitle}>Product Information</h3>
              <p style={styles.paragraph}>To provide AI-powered search and filtering, we may access:</p>
              <ul style={styles.gridList}>
                <li>Product titles</li>
                <li>Product descriptions</li>
                <li>Product images</li>
                <li>Product variants</li>
                <li>Collections</li>
                <li>Tags</li>
                <li>Product types</li>
                <li>Vendors</li>
                <li>Inventory status</li>
                <li>Pricing information</li>
                <li>Metafields (when required)</li>
              </ul>
            </div>

            <div style={styles.subBlock}>
              <h3 style={styles.subTitle}>Theme Information</h3>
              <p style={styles.paragraph}>If required for installation or app functionality, we may access:</p>
              <ul style={styles.list}>
                <li>Theme ID</li>
                <li>Theme settings</li>
                <li>App embeds</li>
                <li>Theme extensions</li>
              </ul>
            </div>

            <div style={styles.subBlock}>
              <h3 style={styles.subTitle}>Customer Information</h3>
              <ul style={styles.list}>
                <li>The App does not collect or store customer personal information unless explicitly required for a feature enabled by the merchant.</li>
                <li>If customer data is accessed, it is limited to what is necessary to provide the requested functionality and is processed in accordance with Shopify's API requirements.</li>
              </ul>
            </div>
          </section>

          {/* Section 2 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>2. How We Use Information</h2>
            <p style={styles.paragraph}>We use collected information to:</p>
            <ul style={styles.gridList}>
              <li>Deliver AI-powered search functionality</li>
              <li>Generate smart product filters</li>
              <li>Improve search relevance</li>
              <li>Display search suggestions</li>
              <li>Synchronize product data</li>
              <li>Provide analytics</li>
              <li>Detect errors</li>
              <li>Improve performance</li>
              <li>Respond to support requests</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>3. Data Storage</h2>
            <p style={styles.paragraph}>
              Store data may be securely stored on our servers for synchronization, indexing, caching, and application functionality.
            </p>
            <p style={styles.paragraph}>
              We implement reasonable administrative, technical, and physical safeguards to protect merchant information.
            </p>
          </section>

          {/* Section 4 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>4. Data Sharing</h2>
            <p style={styles.paragraph}>
              We do not sell merchant or customer information.
            </p>
            <p style={styles.paragraph}>
              Information may only be shared with trusted service providers who assist us in operating the App, including:
            </p>
            <ul style={styles.list}>
              <li>Cloud hosting providers</li>
              <li>Database providers</li>
              <li>Error monitoring services</li>
              <li>Analytics providers</li>
            </ul>
            <p style={styles.paragraph}>
              These providers are contractually obligated to protect your information.
            </p>
          </section>

          {/* Section 5 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>5. Shopify APIs</h2>
            <p style={styles.paragraph}>
              The App uses Shopify APIs solely to provide requested functionality.
            </p>
            <p style={styles.paragraph}>
              We only request the permissions required for features used by the merchant.
            </p>
          </section>

          {/* Section 6 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>6. Cookies and Analytics</h2>
            <p style={styles.paragraph}>The App may use cookies or similar technologies to:</p>
            <ul style={styles.list}>
              <li>Maintain sessions</li>
              <li>Improve performance</li>
              <li>Measure usage</li>
              <li>Diagnose issues</li>
            </ul>
          </section>

          {/* Section 7 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>7. Data Retention</h2>
            <p style={styles.paragraph}>
              We retain merchant information only as long as necessary to provide the App's services or comply with legal obligations.
            </p>
            <p style={styles.paragraph}>
              If the App is uninstalled, associated merchant data will be deleted within a reasonable period unless retention is required by law.
            </p>
          </section>

          {/* Section 8 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>8. Security</h2>
            <p style={styles.paragraph}>We use industry-standard security practices, including:</p>
            <ul style={styles.gridList}>
              <li>HTTPS encryption</li>
              <li>Secure authentication</li>
              <li>Access controls</li>
              <li>Encrypted data transmission</li>
              <li>Regular security updates</li>
            </ul>
            <p style={styles.paragraph}>
              While no system is completely secure, we strive to protect all information entrusted to us.
            </p>
          </section>

          {/* Section 9 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>9. Merchant Rights</h2>
            <p style={styles.paragraph}>Merchants may request to:</p>
            <ul style={styles.list}>
              <li>Access stored information</li>
              <li>Correct inaccurate information</li>
              <li>Request deletion of stored data</li>
              <li>Ask questions regarding data handling</li>
            </ul>
            <p style={styles.paragraph}>
              Requests can be made using the contact information below.
            </p>
          </section>

          {/* Section 10 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>10. Third-Party Services</h2>
            <p style={styles.paragraph}>
              The App may integrate with third-party services necessary to provide functionality. Those services are governed by their own privacy policies.
            </p>
          </section>

          {/* Section 11 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>11. Children's Privacy</h2>
            <p style={styles.paragraph}>
              The App is intended for use by businesses and is not directed toward children under the age of 13.
            </p>
          </section>

          {/* Section 12 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>12. Changes to This Policy</h2>
            <p style={styles.paragraph}>
              We may update this Privacy Policy from time to time.
            </p>
            <p style={styles.paragraph}>
              Any changes will be posted on this page with an updated effective date.
            </p>
          </section>

          {/* Section 13 */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>13. Contact Us</h2>
            <p style={styles.paragraph}>
              If you have questions about this Privacy Policy, please contact us:
            </p>
            <div style={styles.contactCard}>
              <div style={styles.contactName}>webvort</div>
              <div style={styles.contactItem}>
                <strong>Email:</strong>{" "}
                <a href="mailto:info.webvory@gmail.com" style={styles.link}>info.webvory@gmail.com</a>,{" "}
                <a href="mailto:veenitkumar.ca2012@gmail.com" style={styles.link}>veenitkumar.ca2012@gmail.com</a>
              </div>
              <div style={styles.contactItem}>
                <strong>Website:</strong>{" "}
                <a href="https://webvory.com" target="_blank" rel="noopener noreferrer" style={styles.link}>
                  https://webvory.com
                </a>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer style={styles.footer}>
        <p>© {new Date().getFullYear()} AI Search & Filter. All rights reserved.</p>
      </footer>
    </div>
  );
}

const styles = {
  pageContainer: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    backgroundColor: "#f8fafc",
    color: "#1e293b",
    minHeight: "100vh",
    margin: 0,
    padding: 0,
    lineHeight: 1.6,
  },
  headerBanner: {
    background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
    color: "#ffffff",
    padding: "60px 20px 40px",
    textAlign: "center",
  },
  headerContent: {
    maxWidth: "800px",
    margin: "0 auto",
  },
  badge: {
    display: "inline-block",
    backgroundColor: "rgba(59, 130, 246, 0.2)",
    color: "#60a5fa",
    border: "1px solid rgba(96, 165, 250, 0.3)",
    borderRadius: "20px",
    padding: "4px 16px",
    fontSize: "0.875rem",
    fontWeight: "600",
    marginBottom: "16px",
    letterSpacing: "0.5px",
  },
  mainTitle: {
    fontSize: "2.5rem",
    fontWeight: "700",
    margin: "0 0 12px",
    letterSpacing: "-0.5px",
  },
  effectiveDate: {
    fontSize: "0.95rem",
    color: "#94a3b8",
    margin: 0,
  },
  mainContainer: {
    maxWidth: "860px",
    margin: "-20px auto 40px",
    padding: "0 20px",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.05), 0 2px 6px -1px rgba(0, 0, 0, 0.02)",
    padding: "40px",
    border: "1px solid #e2e8f0",
  },
  introText: {
    fontSize: "1.1rem",
    color: "#334155",
    borderBottom: "1px solid #e2e8f0",
    paddingBottom: "24px",
    marginBottom: "32px",
  },
  section: {
    marginBottom: "36px",
  },
  sectionTitle: {
    fontSize: "1.35rem",
    fontWeight: "700",
    color: "#0f172a",
    margin: "0 0 16px",
    paddingBottom: "8px",
    borderBottom: "2px solid #f1f5f9",
  },
  subBlock: {
    marginTop: "16px",
    marginBottom: "20px",
    backgroundColor: "#f8fafc",
    borderRadius: "8px",
    padding: "16px 20px",
    border: "1px solid #f1f5f9",
  },
  subTitle: {
    fontSize: "1.05rem",
    fontWeight: "600",
    color: "#1e293b",
    margin: "0 0 10px",
  },
  paragraph: {
    fontSize: "1rem",
    color: "#475569",
    margin: "0 0 12px",
  },
  list: {
    margin: "8px 0 12px",
    paddingLeft: "24px",
    color: "#475569",
  },
  gridList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "8px 16px",
    margin: "12px 0",
    paddingLeft: "20px",
    color: "#475569",
  },
  contactCard: {
    backgroundColor: "#f0f9ff",
    border: "1px solid #bae6fd",
    borderRadius: "12px",
    padding: "20px",
    marginTop: "16px",
  },
  contactName: {
    fontSize: "1.1rem",
    fontWeight: "700",
    color: "#0369a1",
    marginBottom: "8px",
  },
  contactItem: {
    fontSize: "0.98rem",
    color: "#0c4a6e",
    marginBottom: "6px",
  },
  link: {
    color: "#0284c7",
    textDecoration: "none",
    fontWeight: "500",
  },
  footer: {
    textAlign: "center",
    padding: "24px 20px",
    color: "#94a3b8",
    fontSize: "0.875rem",
    borderTop: "1px solid #e2e8f0",
  },
};
