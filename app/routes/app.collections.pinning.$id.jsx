import { useState, useCallback, useRef, useEffect } from "react";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useNavigate,
  useFetcher,
  redirect,
} from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useAppBridge } from "@shopify/app-bridge-react";

export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const ruleId = params.id;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "search") {
    const query = formData.get("q") || "";
    const collectionsStr = formData.get("collections");
    const collections = collectionsStr ? JSON.parse(collectionsStr) : [];
    const applyToAll = formData.get("applyToAll") === "true";

    const whereClause = { shop, status: "active" };

    if (query.trim() !== "") {
      whereClause.title = { contains: query, mode: "insensitive" };
    }

    if (!applyToAll && collections.length > 0) {
      whereClause.collections = {
        some: {
          collection: { title: { in: collections } },
        },
      };
    }

    const skip = parseInt(formData.get("skip") || "0", 10);
    const excludedIdsStr = formData.get("excludedIds");
    const excludedIds = excludedIdsStr ? JSON.parse(excludedIdsStr) : [];
    
    if (excludedIds.length > 0) {
      whereClause.id = { notIn: excludedIds };
    }

    const totalCount = await prisma.product.count({ where: whereClause });

    const productsResult = await prisma.product.findMany({
      where: whereClause,
      take: 9,
      skip: skip,
      select: {
        id: true,
        title: true,
        handle: true,
        images: true,
      },
    });

    const products = productsResult.map((p) => {
      let image = null;
      if (p.images) {
        const parsedImages =
          typeof p.images === "string" ? JSON.parse(p.images) : p.images;
        if (Array.isArray(parsedImages) && parsedImages.length > 0) {
          image = parsedImages[0];
        }
      }
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        image,
      };
    });

    return Response.json({ products, totalCount });
  }

  if (intent === "save") {
    const productsJSON = formData.get("products");
    const name = formData.get("name") || "Pinning Rule";
    const collectionsJSON = formData.get("collections");
    const applyToAll = formData.get("applyToAll") === "true";

    const data = {
      shop,
      name,
      collections: JSON.parse(collectionsJSON),
      applyToAll,
      products: JSON.parse(productsJSON),
      status: true,
    };

    let savedRule;
    if (ruleId === "new") {
      savedRule = await prisma.pinnedProductRule.create({ data });
    } else {
      savedRule = await prisma.pinnedProductRule.update({
        where: { id: ruleId, shop },
        data,
      });
    }
    return redirect("/app/collections/pinning");
  }

  return Response.json({ success: false });
};

export const loader = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const ruleId = params.id;

  const url = new URL(request.url);
  const searchCollections = url.searchParams.get("collections");
  const searchApplyToAll = url.searchParams.get("applyToAll") === "true";

  let defaultParams = null;
  if (ruleId === "new" && (searchCollections || searchApplyToAll)) {
    try {
      defaultParams = {
        collections: searchCollections ? JSON.parse(searchCollections) : [],
        applyToAll: searchApplyToAll,
      };
    } catch (e) {}
  }

  let rule = null;
  if (ruleId !== "new") {
    rule = await prisma.pinnedProductRule.findFirst({
      where: { id: ruleId, shop },
    });
  }

  // Fetch collections for dropdown
  const graphqlQuery = `
    query {
      collections(first: 250) {
        nodes {
          id
          title
        }
      }
    }
  `;
  const response = await admin.graphql(graphqlQuery);
  const result = await response.json();
  const allCollections =
    result.data?.collections?.nodes?.map((c) => c.title).sort() || [];

  return { rule, allCollections, defaultParams };
};

export default function PinningEditor() {
  const { rule, allCollections, defaultParams } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const initialCollections =
    rule?.collections || defaultParams?.collections || [];
  const initialApplyToAll =
    rule?.applyToAll || defaultParams?.applyToAll || false;
  const defaultName =
    rule?.name ||
    (initialApplyToAll
      ? "All Collections"
      : initialCollections.length > 0
        ? initialCollections.join(", ")
        : "New Pinning Rule");

  const initialProducts = rule?.products
    ? typeof rule.products === "string"
      ? JSON.parse(rule.products)
      : rule.products
    : [];

  const [products, setProducts] = useState(initialProducts);
  const [name, setName] = useState(defaultName);
  const [selectedCollections, setSelectedCollections] =
    useState(initialCollections);
  const [applyToAll, setApplyToAll] = useState(initialApplyToAll);
  const [applyToInstantSearch, setApplyToInstantSearch] = useState(
    rule?.applyToInstantSearch ?? true,
  );
  const [applyToSearchResults, setApplyToSearchResults] = useState(
    rule?.applyToSearchResults ?? false,
  );

  const [isUnsavedModalOpen, setIsUnsavedModalOpen] = useState(false);
  const [pendingDestination, setPendingDestination] = useState(null);

  const hasUnsavedChanges =
    JSON.stringify(products) !== JSON.stringify(initialProducts) ||
    name !== defaultName ||
    JSON.stringify(selectedCollections) !== JSON.stringify(initialCollections) ||
    applyToAll !== initialApplyToAll ||
    applyToInstantSearch !== (rule?.applyToInstantSearch ?? true) ||
    applyToSearchResults !== (rule?.applyToSearchResults ?? false);

  const handleNavigate = (destination) => {
    if (hasUnsavedChanges) {
      setPendingDestination(destination);
      setIsUnsavedModalOpen(true);
    } else {
      navigate(destination);
    }
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedSearchQuery, setPinnedSearchQuery] = useState("");
  const [selectedPinnedIds, setSelectedPinnedIds] = useState([]);

  const [searchResults, setSearchResults] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const observerTarget = useRef(null);

  const totalPages = Math.ceil(totalCount / 9);

  const isSaving =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "save";



  // Drag and drop state
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  const handleDragStart = (e, position) => {
    dragItem.current = position;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({ type: "REORDER", index: position }),
    );
    e.dataTransfer.setData("text/plain", position.toString());
  };

  const handleDragEnter = (e, position) => {
    e.preventDefault();
    dragOverItem.current = position;
  };

  const handleDragEnd = () => {
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const handleDrop = (e, position) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if it's a reorder (internal drag)
    if (dragItem.current !== null) {
      const fromIndex = dragItem.current;
      if (fromIndex !== position) {
        const newProducts = [...products];
        const draggedItem = newProducts[fromIndex];
        newProducts.splice(fromIndex, 1);
        newProducts.splice(position, 0, draggedItem);
        setProducts(newProducts);
      }
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }

    // Otherwise it's a NEW_PIN from the left pane
    const dataStr = e.dataTransfer.getData("application/json");
    if (!dataStr) return;

    try {
      const data = JSON.parse(dataStr);
      if (data.type === "NEW_PIN") {
        const prod = data.product;
        if (products.some((p) => p.id === prod.id)) return;
        const newProducts = [...products];
        newProducts.splice(position, 0, prod);
        setProducts(newProducts);
      }
    } catch (err) {}

    dragItem.current = null;
    dragOverItem.current = null;
  };

  const handleContainerDrop = (e) => {
    e.preventDefault();

    // Check if it's a reorder (internal drag) dropped at the end
    if (dragItem.current !== null) {
      const fromIndex = dragItem.current;
      const newProducts = [...products];
      const draggedItem = newProducts[fromIndex];
      newProducts.splice(fromIndex, 1);
      newProducts.push(draggedItem);
      setProducts(newProducts);
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }

    // Otherwise it's a NEW_PIN from the left pane
    const dataStr = e.dataTransfer.getData("application/json");
    if (!dataStr) return;

    try {
      const data = JSON.parse(dataStr);
      if (data.type === "NEW_PIN") {
        const prod = data.product;
        if (products.some((p) => p.id === prod.id)) return;
        setProducts([...products, prod]);
      }
    } catch (err) {}

    dragItem.current = null;
    dragOverItem.current = null;
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchQuery !== undefined) {
        setCurrentPage(0);
        setSearchResults([]);
        setIsFetchingMore(true);
        fetcher.submit(
          {
            intent: "search",
            q: searchQuery,
            collections: JSON.stringify(selectedCollections),
            applyToAll: applyToAll,
            skip: 0,
            excludedIds: JSON.stringify(products.map(p => p.id))
          },
          { method: "post" },
        );
      }
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, selectedCollections, applyToAll]);

  // When products (pinned list) changes, we should refetch the current page 
  // so the backend naturally replenishes the missing slots
  useEffect(() => {
    if (searchQuery !== undefined) {
      fetcher.submit(
        {
          intent: "search",
          q: searchQuery,
          collections: JSON.stringify(selectedCollections),
          applyToAll: applyToAll,
          skip: currentPage * 9,
          excludedIds: JSON.stringify(products.map(p => p.id))
        },
        { method: "post" },
      );
    }
  }, [products]); // Run whenever a product is pinned/unpinned

  useEffect(() => {
    if (fetcher.data?.products) {
      setSearchResults(fetcher.data.products);
      if (fetcher.data.totalCount !== undefined) {
        setTotalCount(fetcher.data.totalCount);
      }
      setIsFetchingMore(false);
    }
  }, [fetcher.data]);

  const handleNextPage = () => {
    if (currentPage < totalPages - 1 && !isFetchingMore) {
      setIsFetchingMore(true);
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      fetcher.submit(
        {
          intent: "search",
          q: searchQuery,
          collections: JSON.stringify(selectedCollections),
          applyToAll: applyToAll,
          skip: nextPage * 9,
          excludedIds: JSON.stringify(products.map(p => p.id))
        },
        { method: "post" },
      );
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 0 && !isFetchingMore) {
      setIsFetchingMore(true);
      const prevPage = currentPage - 1;
      setCurrentPage(prevPage);
      fetcher.submit(
        {
          intent: "search",
          q: searchQuery,
          collections: JSON.stringify(selectedCollections),
          applyToAll: applyToAll,
          skip: prevPage * 9,
          excludedIds: JSON.stringify(products.map(p => p.id))
        },
        { method: "post" },
      );
    }
  };

  const wheelLock = useRef(false);
  const handleWheel = (e) => {
    const container = e.currentTarget;
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 10;
    const isAtTop = container.scrollTop <= 10;

    if (e.deltaY > 30 && !isAtBottom) return;
    if (e.deltaY < -30 && !isAtTop) return;

    if (wheelLock.current) return;
    
    if (e.deltaY > 30) {
      if (currentPage < totalPages - 1) {
        wheelLock.current = true;
        handleNextPage();
        setTimeout(() => { wheelLock.current = false; }, 800);
      }
    } else if (e.deltaY < -30) {
      if (currentPage > 0) {
        wheelLock.current = true;
        handlePrevPage();
        setTimeout(() => { wheelLock.current = false; }, 800);
      }
    }
  };

  const handlePin = (prod) => {
    if (!products.find((p) => p.id === prod.id)) {
      setProducts([...products, prod]);
    }
  };

  const handleUnpin = (index) => {
    const newProducts = [...products];
    const removedId = newProducts[index].id;
    newProducts.splice(index, 1);
    setProducts(newProducts);
    setSelectedPinnedIds(selectedPinnedIds.filter((id) => id !== removedId));
  };

  const handleMoveToTop = () => {
    if (selectedPinnedIds.length === 0) return;
    const selected = products.filter((p) => selectedPinnedIds.includes(p.id));
    const unselected = products.filter(
      (p) => !selectedPinnedIds.includes(p.id),
    );
    setProducts([...selected, ...unselected]);
  };

  const handleMoveToBottom = () => {
    if (selectedPinnedIds.length === 0) return;
    const selected = products.filter((p) => selectedPinnedIds.includes(p.id));
    const unselected = products.filter(
      (p) => !selectedPinnedIds.includes(p.id),
    );
    setProducts([...unselected, ...selected]);
  };

  const toggleSelection = (id) => {
    if (selectedPinnedIds.includes(id)) {
      setSelectedPinnedIds(selectedPinnedIds.filter((i) => i !== id));
    } else {
      setSelectedPinnedIds([...selectedPinnedIds, id]);
    }
  };

  const handleCollectionChange = (e) => {
    const options = e.target.options;
    const values = [];
    for (let i = 0; i < options.length; i++) {
      if (options[i].selected) {
        values.push(options[i].value);
      }
    }
    setSelectedCollections(values);
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("name", name);
    formData.append("collections", JSON.stringify(selectedCollections));
    formData.append("applyToAll", applyToAll.toString());
    formData.append("applyToInstantSearch", applyToInstantSearch.toString());
    formData.append("applyToSearchResults", applyToSearchResults.toString());
    formData.append("products", JSON.stringify(products));

    submit(formData, { method: "POST" });
    shopify.toast.show("Pinning saved successfully");
  };

  return (
    <s-page heading={name} fullWidth>
      <style>{`
        s-page {
          max-width: none !important;
          width: 100% !important;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: #94a3b8;
        }
        .product-search-card .pin-btn-overlay {
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s, visibility 0.2s;
        }
        .product-search-card:hover .pin-btn-overlay {
          opacity: 1;
          visibility: visible;
        }
      `}</style>
      <ui-title-bar title={name}>
        <button
          variant="breadcrumb"
          onClick={() => handleNavigate("/app/collections/pinning")}
        >
          Product Pinning
        </button>
      </ui-title-bar>

      <div
        style={{
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "14px",
        }}
      >
        <a
          href="/app/collections/pinning"
          onClick={(e) => {
            e.preventDefault();
            handleNavigate("/app/collections/pinning");
          }}
          style={{
            color: "#006e52",
            textDecoration: "none",
            fontWeight: "500",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <svg
            style={{ width: "16px", height: "16px" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            ></path>
          </svg>
          Back to Pinning Rules
        </a>
      </div>

      <div
        style={{
          fontFamily: "Inter, sans-serif",
          background: "#f8f9fa",
          minHeight: "100vh",
          padding: "20px",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#fff",
            padding: "16px 24px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            marginBottom: "20px",
          }}
        >
          <div>
            <button
              onClick={() => handleNavigate("/app/collections/pinning")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#64748b",
                display: "flex",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <svg
                style={{ width: "16px", height: "16px", marginRight: "4px" }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                ></path>
              </svg>
              Back
            </button>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                fontSize: "20px",
                fontWeight: "600",
                color: "#1e293b",
                border: "none",
                background: "transparent",
                outline: "none",
                width: "300px",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => handleNavigate("/app/collections/pinning")}
              style={{
                background: "#fff",
                border: "1px solid #cbd5e1",
                padding: "8px 16px",
                borderRadius: "20px",
                color: "#334155",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              style={{
                background: "#007bff",
                color: "#fff",
                border: "none",
                padding: "8px 16px",
                borderRadius: "20px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: isSaving ? "not-allowed" : "pointer",
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "20px" }}>
          {/* Left Pane: Search */}
          <div
            style={{
              flex: 1,
              background: "#fff",
              borderRadius: "8px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
            }}
          >


            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginBottom: "20px",
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  background: "#f8fafc",
                  padding: "10px 16px",
                  borderRadius: "24px",
                  border: "1px solid #e2e8f0",
                }}
              >
                <svg
                  style={{
                    width: "16px",
                    height: "16px",
                    color: "#94a3b8",
                    marginRight: "8px",
                  }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  ></path>
                </svg>
                <input
                  type="text"
                  placeholder="Search to pin products"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    border: "none",
                    background: "transparent",
                    outline: "none",
                    fontSize: "14px",
                    color: "#334155",
                    width: "100%",
                  }}
                />
              </div>
              <button
                style={{
                  background: "#007bff",
                  color: "#fff",
                  border: "none",
                  padding: "10px 24px",
                  borderRadius: "24px",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Search
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                maxHeight: "600px",
                marginTop: "10px",
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "12px",
                alignContent: "start",
                paddingRight: "8px"
              }}
              onWheel={handleWheel}
            >
              {searchResults.length === 0 ? (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
                  {isFetchingMore || fetcher.state === "submitting" ? "Searching..." : (searchQuery ? "No products found." : "No products available.")}
                </div>
              ) : (
                <>
                  {searchResults.map((prod) => (
                      <div
                        key={prod.id}
                        className="product-search-card"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "copy";
                          e.dataTransfer.setData("application/json", JSON.stringify({ type: "NEW_PIN", product: prod }));
                          e.dataTransfer.setData("text/plain", "NEW_PIN");
                        }}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          background: "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                          overflow: "hidden",
                          cursor: "grab",
                          position: "relative",
                          opacity: (isFetchingMore || fetcher.state === "submitting") ? 0.6 : 1,
                          transition: "opacity 0.2s, box-shadow 0.2s, transform 0.2s",
                          height: "270px"
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}
                      >
                        <div style={{ width: "100%", height: "200px", background: "#f1f5f9", position: "relative", flexShrink: 0, overflow: "hidden" }}>
                          {prod.image ? (
                            <img src={prod.image} alt={prod.title} style={{ width: "100%", height: "100%", objectFit: "cover", background: "#fff" }} />
                          ) : (
                            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "12px" }}>No Img</div>
                          )}
                          
                          {/* Pin Button overlay */}
                          <div className="pin-btn-overlay" style={{ position: "absolute", top: "8px", right: "8px" }}>
                            <button 
                              onClick={() => handlePin(prod)} 
                              style={{ width: "32px", height: "32px", background: "#007bff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer", color: "#fff", boxShadow: "0 2px 6px rgba(0,123,255,0.4)", transition: "transform 0.1s" }}
                              onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.1)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                              onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.9)"}
                              onMouseUp={(e) => e.currentTarget.style.transform = "scale(1.1)"}
                              title="Pin this product"
                            >
                              <svg style={{ width: "16px", height: "16px", transform: "rotate(45deg)" }} fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1a1 1 0 000-2H7a1 1 0 000 2h1v8l-2 3v2h5v6l1 1 1-1v-6h5v-2l-2-3z"></path></svg>
                            </button>
                          </div>
                        </div>
                        <div style={{ padding: "12px", display: "flex", flexDirection: "column", flex: 1 }}>
                          <span style={{ fontSize: "13px", fontWeight: "500", color: "#334155", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: "1.4" }}>
                            {prod.title}
                          </span>
                        </div>
                      </div>
                    ))}
                  {isFetchingMore && (
                    <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "12px", color: "#64748b", fontSize: "13px" }}>
                      Loading...
                    </div>
                  )}
                  
                  {/* Pagination Controls */}
                  {totalCount > 0 && (
                    <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", padding: "8px 0", borderTop: "1px solid #e2e8f0" }}>
                      <button
                        onClick={handlePrevPage}
                        disabled={currentPage === 0 || isFetchingMore}
                        style={{
                          background: (currentPage === 0 || isFetchingMore) ? "#f1f5f9" : "#fff",
                          color: (currentPage === 0 || isFetchingMore) ? "#94a3b8" : "#334155",
                          border: "1px solid #e2e8f0",
                          padding: "6px 16px",
                          borderRadius: "4px",
                          fontSize: "13px",
                          fontWeight: "500",
                          cursor: (currentPage === 0 || isFetchingMore) ? "default" : "pointer"
                        }}
                      >
                        Previous
                      </button>
                      <span style={{ fontSize: "12px", color: "#64748b" }}>
                        Page {currentPage + 1} of {Math.max(1, totalPages)} ({totalCount} total unpinned)
                      </span>
                      <button
                        onClick={handleNextPage}
                        disabled={currentPage >= totalPages - 1 || isFetchingMore}
                        style={{
                          background: (currentPage >= totalPages - 1 || isFetchingMore) ? "#f1f5f9" : "#fff",
                          color: (currentPage >= totalPages - 1 || isFetchingMore) ? "#94a3b8" : "#334155",
                          border: "1px solid #e2e8f0",
                          padding: "6px 16px",
                          borderRadius: "4px",
                          fontSize: "13px",
                          fontWeight: "500",
                          cursor: (currentPage >= totalPages - 1 || isFetchingMore) ? "default" : "pointer"
                        }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right Pane: Settings & Pinned List */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            {/* Pinned Products */}
            <div
              style={{
                background: "#fff",
                borderRadius: "8px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                padding: "20px",
                flex: 1,
                minHeight: "200px",
                display: "flex",
                flexDirection: "column",
              }}
              onDrop={handleContainerDrop}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect =
                  dragItem.current !== null ? "move" : "copy";
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    background: "#f8fafc",
                    padding: "10px 16px",
                    borderRadius: "24px",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <svg
                    style={{
                      width: "16px",
                      height: "16px",
                      color: "#94a3b8",
                      marginRight: "8px",
                    }}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    ></path>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search pinned products"
                    value={pinnedSearchQuery}
                    onChange={(e) => setPinnedSearchQuery(e.target.value)}
                    style={{
                      border: "none",
                      background: "transparent",
                      outline: "none",
                      fontSize: "14px",
                      color: "#334155",
                      width: "100%",
                    }}
                  />
                </div>
                <button
                  onClick={() => {
                    setProducts([]);
                    setSelectedPinnedIds([]);
                  }}
                  style={{
                    background: "transparent",
                    border: "1px solid #007bff",
                    color: "#007bff",
                    padding: "8px 20px",
                    borderRadius: "24px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Clear pinned list
                </button>
              </div>

              {products.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    marginBottom: "16px",
                    paddingBottom: "12px",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  <button
                    onClick={handleMoveToTop}
                    disabled={selectedPinnedIds.length === 0}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      background:
                        selectedPinnedIds.length > 0 ? "#eff6ff" : "#f8fafc",
                      border: "none",
                      padding: "6px 16px",
                      borderRadius: "24px",
                      color:
                        selectedPinnedIds.length > 0 ? "#007bff" : "#94a3b8",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor:
                        selectedPinnedIds.length > 0
                          ? "pointer"
                          : "not-allowed",
                      transition: "all 0.2s",
                    }}
                  >
                    <div
                      style={{
                        background:
                          selectedPinnedIds.length > 0 ? "#007bff" : "#cbd5e1",
                        color: "#fff",
                        borderRadius: "50%",
                        width: "20px",
                        height: "20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <svg
                        style={{ width: "12px", height: "12px" }}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M5 15l7-7 7 7"
                        ></path>
                      </svg>
                    </div>
                    Move selected items to top
                  </button>
                  <button
                    onClick={handleMoveToBottom}
                    disabled={selectedPinnedIds.length === 0}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      background:
                        selectedPinnedIds.length > 0 ? "#eff6ff" : "#f8fafc",
                      border: "none",
                      padding: "6px 16px",
                      borderRadius: "24px",
                      color:
                        selectedPinnedIds.length > 0 ? "#007bff" : "#94a3b8",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor:
                        selectedPinnedIds.length > 0
                          ? "pointer"
                          : "not-allowed",
                      transition: "all 0.2s",
                    }}
                  >
                    <div
                      style={{
                        background:
                          selectedPinnedIds.length > 0 ? "#007bff" : "#cbd5e1",
                        color: "#fff",
                        borderRadius: "50%",
                        width: "20px",
                        height: "20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <svg
                        style={{ width: "12px", height: "12px" }}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M19 9l-7 7-7-7"
                        ></path>
                      </svg>
                    </div>
                    Move selected items to bottom
                  </button>
                </div>
              )}

              {products.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "80px 20px",
                    color: "#94a3b8",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <div style={{ fontSize: "14px", color: "#94a3b8" }}>
                    Drag and drop products from the left side to pin.
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gridAutoRows: "max-content",
                    gap: "12px",
                    maxHeight: "600px",
                    overflowY: "auto",
                    alignContent: "start",
                    padding: "4px",
                    // Adding custom scrollbar for webkit browsers
                    scrollbarWidth: "thin",
                    scrollbarColor: "#cbd5e1 transparent",
                  }}
                  className="custom-scrollbar"
                >
                  {products
                    .filter((p) => p.title.toLowerCase().includes(pinnedSearchQuery.toLowerCase()))
                    .map((prod, index) => (
                      <div
                        key={prod.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragEnter={(e) => handleDragEnter(e, index)}
                        onDragEnd={handleDragEnd}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = dragItem.current !== null ? "move" : "copy";
                        }}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          background: selectedPinnedIds.includes(prod.id) ? "#f0f7ff" : "#fff",
                          border: selectedPinnedIds.includes(prod.id) ? "2px solid #007bff" : "1px solid #e2e8f0",
                          borderRadius: "8px",
                          overflow: "hidden",
                          cursor: "grab",
                          position: "relative",
                          transition: "all 0.2s",
                          height: "270px"
                        }}
                      >
                        <div style={{ position: "absolute", top: "6px", left: "6px", zIndex: 10 }}>
                          <input
                            type="checkbox"
                            checked={selectedPinnedIds.includes(prod.id)}
                            onChange={() => toggleSelection(prod.id)}
                            style={{ accentColor: "#007bff", width: "16px", height: "16px", cursor: "pointer", margin: 0 }}
                          />
                        </div>
                        <div style={{ position: "absolute", top: "6px", right: "6px", zIndex: 10 }}>
                          <button
                            onClick={() => handleUnpin(index)}
                            style={{ background: "#fff", border: "none", borderRadius: "50%", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444", cursor: "pointer", boxShadow: "0 2px 4px rgba(0,0,0,0.1)", opacity: 0.9 }}
                            title="Remove pin"
                          >
                            <svg style={{ width: "14px", height: "14px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                          </button>
                        </div>
                        
                        <div style={{ width: "100%", height: "200px", background: "#f1f5f9", position: "relative", flexShrink: 0, overflow: "hidden" }}>
                          {prod.image ? (
                            <img src={prod.image} alt={prod.title} style={{ width: "100%", height: "100%", objectFit: "cover", background: "#fff" }} />
                          ) : (
                            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "12px" }}>No Img</div>
                          )}
                          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.5)", color: "#fff", padding: "4px 8px", fontSize: "11px", fontWeight: "600", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>Pos: {index + 1}</span>
                            <svg style={{ width: "14px", height: "14px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16"></path></svg>
                          </div>
                        </div>
                        <div style={{ padding: "10px", display: "flex", flexDirection: "column", flex: 1 }}>
                          <span style={{ fontSize: "12px", fontWeight: "500", color: "#334155", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: "1.4" }}>
                            {prod.title}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {isUnsavedModalOpen && (
        <div
          onClick={() => setIsUnsavedModalOpen(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              padding: "24px",
              borderRadius: "12px",
              width: "450px",
              maxWidth: "90%",
              boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: "18px", fontWeight: "600", color: "#1e293b", marginBottom: "8px" }}>Unsaved Changes</h2>
            <p style={{ color: "#475569", marginBottom: "24px", fontSize: "14px", lineHeight: "1.5" }}>
              Your changes have not been saved. Do you really want to cancel and lose these changes?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                onClick={() => setIsUnsavedModalOpen(false)}
                style={{
                  background: "transparent",
                  border: "1px solid #cbd5e1",
                  padding: "8px 16px",
                  borderRadius: "20px",
                  cursor: "pointer",
                  fontWeight: "600",
                  color: "#334155",
                  fontSize: "14px",
                }}
              >
                No, keep editing
              </button>
              <button
                onClick={() => {
                  setIsUnsavedModalOpen(false);
                  navigate(pendingDestination);
                }}
                style={{
                  background: "#ef4444",
                  color: "#fff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "20px",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "14px",
                }}
              >
                Yes, discard changes
              </button>
            </div>
          </div>
        </div>
      )}
    </s-page>
  );
}
