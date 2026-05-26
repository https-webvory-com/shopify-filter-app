import { useState, useCallback, useRef, useEffect } from "react";
import { useLoaderData, useSubmit, useNavigation, useNavigate, useFetcher, redirect } from "react-router";
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
          collection: { title: { in: collections } }
        }
      };
    }

    const skip = parseInt(formData.get("skip") || "0", 10);

    const productsResult = await prisma.product.findMany({
      where: whereClause,
      take: 20,
      skip: skip,
      select: {
        id: true,
        title: true,
        handle: true,
        images: true
      }
    });

    const products = productsResult.map(p => {
      let image = null;
      if (p.images) {
        const parsedImages = typeof p.images === 'string' ? JSON.parse(p.images) : p.images;
        if (Array.isArray(parsedImages) && parsedImages.length > 0) {
          image = parsedImages[0];
        }
      }
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        image
      };
    });

    return Response.json({ products });
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
      status: true
    };

    let savedRule;
    if (ruleId === "new") {
      savedRule = await prisma.pinnedProductRule.create({ data });
    } else {
      savedRule = await prisma.pinnedProductRule.update({
        where: { id: ruleId, shop },
        data
      });
    }
    return redirect("/app/merchandising/pinning");
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
        applyToAll: searchApplyToAll
      };
    } catch(e) {}
  }

  let rule = null;
  if (ruleId !== "new") {
    rule = await prisma.pinnedProductRule.findFirst({
      where: { id: ruleId, shop }
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
  const allCollections = result.data?.collections?.nodes?.map(c => c.title).sort() || [];

  return { rule, allCollections, defaultParams };
};

export default function PinningEditor() {
  const { rule, allCollections, defaultParams } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  
  const initialCollections = rule?.collections || defaultParams?.collections || [];
  const initialApplyToAll = rule?.applyToAll || defaultParams?.applyToAll || false;
  const defaultName = rule?.name || (initialApplyToAll ? "All Collections" : (initialCollections.length > 0 ? initialCollections.join(", ") : "New Pinning Rule"));

  const [products, setProducts] = useState(rule?.products ? (typeof rule.products === 'string' ? JSON.parse(rule.products) : rule.products) : []);
  const [name, setName] = useState(defaultName);
  const [selectedCollections, setSelectedCollections] = useState(initialCollections);
  const [applyToAll, setApplyToAll] = useState(initialApplyToAll);
  const [applyToInstantSearch, setApplyToInstantSearch] = useState(rule?.applyToInstantSearch ?? true);
  const [applyToSearchResults, setApplyToSearchResults] = useState(rule?.applyToSearchResults ?? false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedSearchQuery, setPinnedSearchQuery] = useState("");
  const [selectedPinnedIds, setSelectedPinnedIds] = useState([]);
  
  const [searchResults, setSearchResults] = useState([]);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === "save";

  // Drag and drop state
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  const handleDragStart = (e, position) => {
    dragItem.current = position;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/json", JSON.stringify({ type: "REORDER", index: position }));
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
        if (products.some(p => p.id === prod.id)) return;
        const newProducts = [...products];
        newProducts.splice(position, 0, prod);
        setProducts(newProducts);
      }
    } catch(err) {}

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
        if (products.some(p => p.id === prod.id)) return;
        setProducts([...products, prod]);
      }
    } catch(err) {}

    dragItem.current = null;
    dragOverItem.current = null;
  };

  // Search effect
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchQuery !== undefined) {
        setSkip(0);
        setSearchResults([]);
        setHasMore(true);
        fetcher.submit({ intent: "search", q: searchQuery, collections: JSON.stringify(selectedCollections), applyToAll: applyToAll, skip: 0 }, { method: "post" });
      }
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, selectedCollections, applyToAll]);

  useEffect(() => {
    if (fetcher.data?.products) {
      if (skip === 0) {
        setSearchResults(fetcher.data.products);
      } else {
        setSearchResults(prev => {
          const newProducts = fetcher.data.products.filter(newP => !prev.some(p => p.id === newP.id));
          return [...prev, ...newProducts];
        });
      }
      setHasMore(fetcher.data.products.length === 20);
      setIsFetchingMore(false);
    }
  }, [fetcher.data]);

  const handleScroll = (e) => {
    const bottom = e.target.scrollHeight - e.target.scrollTop <= e.target.clientHeight + 50;
    if (bottom && hasMore && !isFetchingMore && fetcher.state !== "submitting") {
      setIsFetchingMore(true);
      const newSkip = skip + 20;
      setSkip(newSkip);
      fetcher.submit({ intent: "search", q: searchQuery, collections: JSON.stringify(selectedCollections), applyToAll: applyToAll, skip: newSkip }, { method: "post" });
    }
  };

  const handlePin = (prod) => {
    if (!products.find(p => p.id === prod.id)) {
      setProducts([...products, prod]);
    }
  };

  const handleUnpin = (index) => {
    const newProducts = [...products];
    const removedId = newProducts[index].id;
    newProducts.splice(index, 1);
    setProducts(newProducts);
    setSelectedPinnedIds(selectedPinnedIds.filter(id => id !== removedId));
  };

  const handleMoveToTop = () => {
    if (selectedPinnedIds.length === 0) return;
    const selected = products.filter(p => selectedPinnedIds.includes(p.id));
    const unselected = products.filter(p => !selectedPinnedIds.includes(p.id));
    setProducts([...selected, ...unselected]);
  };

  const handleMoveToBottom = () => {
    if (selectedPinnedIds.length === 0) return;
    const selected = products.filter(p => selectedPinnedIds.includes(p.id));
    const unselected = products.filter(p => !selectedPinnedIds.includes(p.id));
    setProducts([...unselected, ...selected]);
  };

  const toggleSelection = (id) => {
    if (selectedPinnedIds.includes(id)) {
      setSelectedPinnedIds(selectedPinnedIds.filter(i => i !== id));
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
    <div style={{ fontFamily: "Inter, sans-serif", background: "#f8f9fa", minHeight: "100vh", padding: "20px" }}>
      <ui-title-bar title={name}></ui-title-bar>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", padding: "16px 24px", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", marginBottom: "20px" }}>
        <div>
          <button onClick={() => navigate("/app/merchandising/pinning")} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", marginBottom: "8px" }}>
            <svg style={{ width: "16px", height: "16px", marginRight: "4px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            Back
          </button>
          <input 
            type="text" 
            value={name} 
            onChange={e => setName(e.target.value)}
            style={{ fontSize: "20px", fontWeight: "600", color: "#1e293b", border: "none", background: "transparent", outline: "none", width: "300px" }}
          />
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button 
            onClick={() => navigate("/app/merchandising/pinning")}
            style={{ background: "#fff", border: "1px solid #cbd5e1", padding: "8px 16px", borderRadius: "20px", color: "#334155", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            style={{ background: "#007bff", color: "#fff", border: "none", padding: "8px 16px", borderRadius: "20px", fontSize: "14px", fontWeight: "600", cursor: isSaving ? "not-allowed" : "pointer", opacity: isSaving ? 0.7 : 1 }}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "20px" }}>
        
        {/* Left Pane: Search */}
        <div style={{ flex: 1, background: "#fff", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", padding: "20px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "24px", marginBottom: "16px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#007bff", fontWeight: "500", cursor: "pointer" }}>
              <input 
                type="checkbox" 
                checked={applyToInstantSearch} 
                onChange={e => setApplyToInstantSearch(e.target.checked)} 
                style={{ accentColor: "#007bff", width: "16px", height: "16px", cursor: "pointer" }}
              />
              Apply to instant search results
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#64748b", fontWeight: "500", cursor: "pointer" }}>
              <input 
                type="checkbox" 
                checked={applyToSearchResults} 
                onChange={e => setApplyToSearchResults(e.target.checked)} 
                style={{ accentColor: "#007bff", width: "16px", height: "16px", cursor: "pointer" }}
              />
              Apply to search results
            </label>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", background: "#f8fafc", padding: "10px 16px", borderRadius: "24px", border: "1px solid #e2e8f0" }}>
              <svg style={{ width: "16px", height: "16px", color: "#94a3b8", marginRight: "8px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              <input 
                type="text" 
                placeholder="Search to pin products" 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ border: "none", background: "transparent", outline: "none", fontSize: "14px", color: "#334155", width: "100%" }} 
              />
            </div>
            <button style={{ background: "#007bff", color: "#fff", border: "none", padding: "10px 24px", borderRadius: "24px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}>
              Search
            </button>
          </div>

          <div 
            style={{ flex: 1, overflowY: "auto", maxHeight: "600px", marginTop: "10px" }}
            onScroll={handleScroll}
          >
            {fetcher.state === "submitting" && skip === 0 ? (
              <div style={{ textAlign: "center", padding: "20px", color: "#64748b" }}>Searching...</div>
            ) : searchResults.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px", color: "#64748b" }}>
                {searchQuery ? "No products found." : "No products available."}
              </div>
            ) : (
              <>
                {searchResults.map(prod => {
                  const isPinned = products.some(p => p.id === prod.id);
                  return (
                    <div 
                      key={prod.id} 
                      draggable={!isPinned}
                      onDragStart={(e) => {
                        if (isPinned) { e.preventDefault(); return; }
                        e.dataTransfer.effectAllowed = "copy";
                        e.dataTransfer.setData("application/json", JSON.stringify({ type: "NEW_PIN", product: prod }));
                        e.dataTransfer.setData("text/plain", "NEW_PIN");
                      }}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px", borderBottom: "1px solid #f1f5f9", cursor: isPinned ? "default" : "grab" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "40px", height: "40px", background: "#f1f5f9", borderRadius: "4px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {prod.image ? <img src={prod.image} alt={prod.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: "12px", color: "#94a3b8" }}>No Img</span>}
                        </div>
                        <span style={{ fontSize: "14px", fontWeight: "500", color: "#334155" }}>{prod.title}</span>
                      </div>
                      <button 
                        onClick={() => !isPinned && handlePin(prod)}
                        disabled={isPinned}
                        style={{ 
                          background: isPinned ? "#f8fafc" : "#e0f2fe", 
                          color: isPinned ? "#94a3b8" : "#0369a1", 
                          border: isPinned ? "1px solid #e2e8f0" : "none", 
                          padding: isPinned ? "5px 11px" : "6px 12px", 
                          borderRadius: "4px", 
                          fontSize: "12px", 
                          fontWeight: "600", 
                          cursor: isPinned ? "not-allowed" : "pointer" 
                        }}
                      >
                        {isPinned ? "✓ Pinned" : "+ Pin"}
                      </button>
                    </div>
                  );
                })}
                {isFetchingMore && (
                  <div style={{ textAlign: "center", padding: "12px", color: "#64748b", fontSize: "13px" }}>Loading more products...</div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Pane: Settings & Pinned List */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "20px" }}>
          


          {/* Pinned Products */}
          <div 
            style={{ background: "#fff", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", padding: "20px", flex: 1, minHeight: "200px", display: "flex", flexDirection: "column" }}
            onDrop={handleContainerDrop}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = dragItem.current !== null ? "move" : "copy"; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", background: "#f8fafc", padding: "10px 16px", borderRadius: "24px", border: "1px solid #e2e8f0" }}>
                <svg style={{ width: "16px", height: "16px", color: "#94a3b8", marginRight: "8px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <input 
                  type="text" 
                  placeholder="Search pinned products" 
                  value={pinnedSearchQuery}
                  onChange={e => setPinnedSearchQuery(e.target.value)}
                  style={{ border: "none", background: "transparent", outline: "none", fontSize: "14px", color: "#334155", width: "100%" }} 
                />
              </div>
              <button 
                onClick={() => { setProducts([]); setSelectedPinnedIds([]); }}
                style={{ background: "transparent", border: "1px solid #007bff", color: "#007bff", padding: "8px 20px", borderRadius: "24px", fontSize: "14px", fontWeight: "600", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                Clear pinned list
              </button>
            </div>

            {products.length > 0 && (
              <div style={{ display: "flex", gap: "12px", marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #f1f5f9" }}>
                <button 
                  onClick={handleMoveToTop}
                  disabled={selectedPinnedIds.length === 0}
                  style={{ display: "flex", alignItems: "center", gap: "8px", background: selectedPinnedIds.length > 0 ? "#eff6ff" : "#f8fafc", border: "none", padding: "6px 16px", borderRadius: "24px", color: selectedPinnedIds.length > 0 ? "#007bff" : "#94a3b8", fontSize: "13px", fontWeight: "600", cursor: selectedPinnedIds.length > 0 ? "pointer" : "not-allowed", transition: "all 0.2s" }}
                >
                  <div style={{ background: selectedPinnedIds.length > 0 ? "#007bff" : "#cbd5e1", color: "#fff", borderRadius: "50%", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg style={{ width: "12px", height: "12px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg>
                  </div>
                  Move selected items to top
                </button>
                <button 
                  onClick={handleMoveToBottom}
                  disabled={selectedPinnedIds.length === 0}
                  style={{ display: "flex", alignItems: "center", gap: "8px", background: selectedPinnedIds.length > 0 ? "#eff6ff" : "#f8fafc", border: "none", padding: "6px 16px", borderRadius: "24px", color: selectedPinnedIds.length > 0 ? "#007bff" : "#94a3b8", fontSize: "13px", fontWeight: "600", cursor: selectedPinnedIds.length > 0 ? "pointer" : "not-allowed", transition: "all 0.2s" }}
                >
                  <div style={{ background: selectedPinnedIds.length > 0 ? "#007bff" : "#cbd5e1", color: "#fff", borderRadius: "50%", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg style={{ width: "12px", height: "12px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                  </div>
                  Move selected items to bottom
                </button>
              </div>
            )}
            
            {products.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 20px", color: "#94a3b8", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <div style={{ fontSize: "14px", color: "#94a3b8" }}>Drag and drop products from the left side to pin.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "400px", overflowY: "auto" }}>
                {products.filter(p => p.title.toLowerCase().includes(pinnedSearchQuery.toLowerCase())).map((prod, index) => (
                  <div 
                    key={prod.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnter={(e) => handleDragEnter(e, index)}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = dragItem.current !== null ? "move" : "copy"; }}
                    style={{ 
                      display: "flex", alignItems: "center", justifyContent: "space-between", 
                      padding: "12px", background: "#f8fafc", border: "1px solid #e2e8f0", 
                      borderRadius: "6px", cursor: "grab" 
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ color: "#cbd5e1", cursor: "grab", marginRight: "4px" }}>
                        <svg style={{ width: "20px", height: "20px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={selectedPinnedIds.includes(prod.id)}
                        onChange={() => toggleSelection(prod.id)}
                        style={{ accentColor: "#007bff", width: "16px", height: "16px", cursor: "pointer" }}
                      />
                      <div style={{ width: "32px", height: "32px", background: "#fff", borderRadius: "4px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {prod.image ? <img src={prod.image} alt={prod.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: "10px", color: "#94a3b8" }}>No Img</span>}
                      </div>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: "500", color: "#334155" }}>{prod.title}</div>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>Position: {index + 1}</div>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleUnpin(index)}
                      style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: "4px" }}
                    >
                      <svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}
