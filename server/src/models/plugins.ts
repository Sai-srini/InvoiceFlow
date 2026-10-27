import mongoose, { Schema } from 'mongoose';

export const minor = (required = false) => ({
  type: Number, required,
  validate: { validator: (v: any) => v === undefined || v === null || Number.isSafeInteger(v), message: 'Money must be an integer number of minor units (paise).' },
});
export const oid = (ref: string, required = false) => ({ type: Schema.Types.ObjectId, ref, required });

const OPS = ['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne', 'distinct'] as const;

/**
 * Multi-tenancy safety net: every query on a tenant model MUST name organisation_id, otherwise it throws.
 * Cross-tenant system queries must opt out explicitly with .setOptions({ skipTenant: true }).
 */
export function tenantPlugin(schema: Schema) {
  schema.add({ organisation_id: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true } });
  const guard = function (this: any) {
    if (this.getOptions().skipTenant) return;
    const f = this.getFilter();
    if (!f || f.organisation_id === undefined) throw new Error(`Tenant guard: a ${this.model.modelName} query is missing organisation_id.`);
  };
  OPS.forEach((op) => schema.pre(op as any, guard));
  schema.pre('aggregate', function (this: any) {
    if (this.options?.skipTenant) return;
    const first = this.pipeline()[0];
    if (!first || !first.$match || first.$match.organisation_id === undefined) throw new Error('Tenant guard: aggregate must start with a $match on organisation_id.');
  });
}

/** Rows can be inserted but never changed or removed through Mongoose. */
export function appendOnlyPlugin(schema: Schema) {
  const block = function () { throw new Error('This collection is append-only.'); };
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'deleteOne', 'deleteMany', 'replaceOne'].forEach((op) => schema.pre(op as any, block));
  schema.pre('save', function (this: any) { if (!this.isNew) throw new Error('This collection is append-only.'); });
}

export const model = <T = any>(name: string, schema: Schema, tenant = true) => {
  if (tenant) schema.plugin(tenantPlugin);
  return (mongoose.models[name] as mongoose.Model<T>) || mongoose.model<T>(name, schema);
};
