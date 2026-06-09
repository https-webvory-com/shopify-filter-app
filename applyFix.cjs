const fs = require('fs');
const file = 'extensions/theme-extension/assets/collectionFilterPro.js';
let code = fs.readFileSync(file, 'utf8');

// 1. Fix placeholder
code = code.replace(/Search \$\{setting\.label\}\.\.\./g, 'Filter options');

// 2. Fix Swatch block
const oldBlock = `<div class="cfp-color-grid" style="display: flex; flex-wrap: wrap; gap: 12px; flex-direction: \\${swatchConf.layout === 'List' ? 'column' : 'row'};">`;
const newBlock = `<div class="cfp-color-grid cfp-color-grid--list">
                \\${(() => {
                  let hasAnyImage = false;
                  if (swatchConf.colors) {
                    for (const k in swatchConf.colors) {
                      if (swatchConf.colors[k].type === 'image' && swatchConf.colors[k].value) {
                        hasAnyImage = true;
                        break;
                      }
                    }
                  }
                  
                  return items.map((item, idx) => {
                    let colorValue = getColorHex(item.value);
                    let isImageItem = false;
                    const itemValueLower = item.value.toLowerCase();
                    
                    let matchedData = null;
                    if (swatchConf.colors) {
                      for (const k in swatchConf.colors) {
                        if (k.toLowerCase() === itemValueLower) {
                          matchedData = swatchConf.colors[k];
                          break;
                        }
                      }
                    }
                    
                    if (matchedData) {
                      if (matchedData.type === 'color' && matchedData.value) colorValue = matchedData.value;
                      else if (matchedData.type === 'image' && matchedData.value) {
                        colorValue = matchedData.value;
                        isImageItem = true;
                      }
                    }
                    
                    const isWhite = !isImageItem && (colorValue.toLowerCase() === '#ffffff' || colorValue.toLowerCase() === 'white' || item.value.toLowerCase() === 'white');
                    const hide = isViewMore && idx >= limit;
                    const bgStyle = isImageItem ? \`background: url('\\${colorValue}') center/cover;\` : \`background:\\${colorValue};\`;
                    
                    // Check if it's active
                    const isActive = activeArray.includes(item.value) || ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal));
                    
                    const useImageLayout = hasAnyImage;
                    
                    let visualHtml = '';
                    if (useImageLayout) {
                      if (isImageItem) {
                        visualHtml = \`<img src="\\${colorValue}" alt="\\${item.value}" style="width: auto; height: 80px; object-fit: contain; margin-bottom: 8px; \\${isActive ? 'outline: 2px solid #000; outline-offset: 4px;' : ''}">\`;
                      } else {
                        // Empty placeholder if icon is missing but group is image-based
                        visualHtml = \`<div style="width: 60px; height: 80px; background: transparent; margin-bottom: 8px;"></div>\`;
                      }
                    } else {
                      visualHtml = \`<span class="cfp-swatch-circle" style="\\${bgStyle} width: 22px; height: 22px; display: inline-block; \\${isCircle ? 'border-radius: 50%;' : 'border-radius: 4px;'} border: 1px solid \\${isWhite ? '#ddd' : '#e1e3e5'}; \\${isActive ? 'box-shadow: 0 0 0 2px #000;' : ''} flex-shrink: 0;"></span>\`;
                    }
                    
                    return \`
                      <label class="cfp-color-swatch \\${hide ? 'cfp-view-more-hidden' : ''} \\${useImageLayout ? 'cfp-swatch-is-image' : ''}" style="\\${hide ? 'display: none;' : ''} display: flex; align-items: center; gap: \\${useImageLayout ? '4px' : '8px'}; cursor: pointer; flex-direction: \\${useImageLayout ? 'column' : 'row'}; justify-content: flex-start; text-align: center; width: 100%; box-sizing: border-box;" title="\\${item.value} \\${globalSettings && globalSettings.showProductCount === false ? '' : \` (\\${item.count})\`}">
                        <input type="checkbox" name="\\${inputName}" value="\\${item.value}" \\${isActive ? 'checked' : ''} style="display:none;">
                        \\${visualHtml}
                        \\${showLabel || useImageLayout ? \`<span class="cfp-swatch-label" style="font-family: 'Montserrat', 'Poppins', 'Inter', sans-serif; font-size: \\${useImageLayout ? '14px' : '15px'}; text-align: \\${useImageLayout ? 'center' : 'left'}; color: #202223;">\\${getDisplayLabel(item.value, prefix)}</span>\` : \`<span class="cfp-swatch-label" style="display:none;">\\${getDisplayLabel(item.value, prefix)}</span>\`}
                      </label>
                    \`;
                  }).join('');
                })()}`;

const startIndex = code.indexOf(oldBlock);
if (startIndex !== -1) {
  // Find the end of the items.map block
  const endMatch = code.substring(startIndex).match(/\}\)\.join\(''\)\}[\s\S]*?<\/div>/);
  if (endMatch) {
    const fullOld = code.substring(startIndex, startIndex + endMatch.index + endMatch[0].length);
    code = code.replace(fullOld, newBlock + '\\n              </div>');
  }
}

fs.writeFileSync(file, code);
