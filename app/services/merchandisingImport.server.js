import prisma from '../db.server';
import { normalizeCondition, validConditions, resolveCollectionTargets } from '../utils/merchandisingCondition.js';
import { importRowInfo, importWriteError } from '../utils/csvImportReport.js';

export async function importMerchandisingRules(shop, rules, ruleType) {
  if (!Array.isArray(rules)) throw Error('Rules must be an array.');
  const report = { imported: 0, skipped: 0, errors: [], warnings: [] };
  for (const [index, rule] of rules.entries()) {
    const info = importRowInfo(rule, index);
    try {
      let reason = rule?.importError;
      const hasOrdinal = rule?.ordinal !== undefined;
      const ordinal = hasOrdinal ? Number(rule.ordinal) : null;
      if (hasOrdinal && (!['string', 'number'].includes(typeof rule.ordinal) || String(rule.ordinal).trim() === '' || !Number.isFinite(ordinal))) reason ||= 'Ordinal must be a finite number.';
      if (!rule || typeof rule.name !== 'string' || !rule.name.trim()) reason ||= 'Rule name is missing or is not text.';
      if (!reason) {
        try { if (!validConditions(rule.conditions)) reason = 'Conditions are missing or incomplete. Check fields, values, numeric ranges and date ranges.'; }
        catch { reason = 'Conditions contain an invalid field or value.'; }
      }
      if (!reason) {
        const invalidAction = rule.conditions.find(c => !['Boost', 'Bury', 'Pin', 'Exclude', 'Include', 'Dynamic'].includes(c.action));
        if (invalidAction) reason = `Unsupported condition action: ${invalidAction.action}. This rule format cannot be imported.`;
      }
      for (const key of ['collections', 'searchQueries']) if (!reason && rule[key] != null && (!Array.isArray(rule[key]) || rule[key].some(v => typeof v !== 'string'))) reason = `${key === 'collections' ? 'Collections' : 'Search queries'} must be a list of text values.`;
      for (const key of ['startDate', 'endDate']) if (!reason && rule[key] && !Number.isFinite(Date.parse(rule[key]))) reason = `${key === 'startDate' ? 'Start' : 'End'} date is invalid.`;
      if (!reason && rule.startDate && rule.endDate && Date.parse(rule.startDate) > Date.parse(rule.endDate)) reason = 'End date is earlier than start date.';
      if (reason) { report.skipped++; report.errors.push({ ...info, reason }); continue; }
      const data = { name: rule.name.trim(), status: rule.status !== false, collections: rule.collections || [], searchQueries: rule.searchQueries || [], customerTags: rule.customerTags || '', locales: rule.locales || '', startDate: rule.startDate ? new Date(rule.startDate) : null, endDate: rule.endDate ? new Date(rule.endDate) : null };
      if (hasOrdinal) data.ordinal = ordinal;
      // Replace conditions atomically; a failed edit must not delete the saved rule.
      const updated = await prisma.$transaction(async tx => {
        const existing = await tx.merchandisingRule.findFirst({ where: { shop, name: data.name, ruleType } });
        if (ruleType === 'collection') Object.assign(data, await resolveCollectionTargets(tx, shop, data.collections, rule.collectionIds, existing));
        const conditions = rule.conditions.map(normalizeCondition);
        if (existing) { await tx.merchandisingRule.update({ where: { id: existing.id }, data: { ...data, conditions: { deleteMany: {}, create: conditions } } }); return true; }
        await tx.merchandisingRule.create({ data: { shop, ruleType, ...data, conditions: { create: conditions } } }); return false;
      });
      report.imported++;
      if (updated) report.warnings.push({ ...info, reason: 'An existing rule with this name was updated, rather than creating a second rule.' });
      if (rule.sourceRows?.length > 1) report.warnings.push({ ...info, reason: `CSV rows ${rule.sourceRows.join(', ')} share this rule name and were combined into one rule.` });
    } catch (error) { report.skipped++; report.errors.push({ ...info, reason: importWriteError(error) }); }
  }
  return report;
}
