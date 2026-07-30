const containsWholeWord = (text, word) => {
  if (!text || !word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|[\\s\\/\\-\\_,.])${escaped}(?:$|[\\s\\/\\-\\_,.])`, "i");
  return regex.test(text);
};

console.log("Rose Gold vs red:", containsWholeWord("Rose Gold", "red"));
console.log("Rose Gold vs Red:", containsWholeWord("Rose Gold", "Red"));
console.log("Red vs red:", containsWholeWord("Red", "red"));
console.log("Deep Red vs red:", containsWholeWord("Deep Red", "red"));
console.log("Dark Red vs red:", containsWholeWord("Dark Red", "red"));
console.log("Red Multi vs red:", containsWholeWord("Red Multi", "red"));
