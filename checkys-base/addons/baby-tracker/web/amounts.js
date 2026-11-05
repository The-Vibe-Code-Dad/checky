(function (root) {
  const ML_PER_OZ = 29.5735295625; // US fluid ounce, not an ounce by weight.
  const api = {
    toMl: (value, unit) => value === null ? null : value * (unit === 'oz' ? ML_PER_OZ : 1),
    fromMl: (value, unit) => value === null ? '' : String(Number((value / (unit === 'oz' ? ML_PER_OZ : 1)).toFixed(3)))
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.checkyBabyAmounts = api;
})(typeof window === 'object' ? window : globalThis);
