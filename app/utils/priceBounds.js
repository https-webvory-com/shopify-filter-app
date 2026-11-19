// Non-negative decimal arithmetic keeps conversion independent of binary
// floating-point error at a displayed boundary. Round half up, once.
export function convertedPriceBound(value, rate, digits = 0) {
  if(value === Infinity || value == null)return value;
  if(!Number.isFinite(Number(value))||Number(value)<0||!Number.isFinite(Number(rate))||Number(rate)<=0||!Number.isInteger(digits)||digits<0||digits>3)throw Error('Invalid price bound');
  const decimal = input => {
    const [mantissa, exponent = '0'] = String(Number(input)).toLowerCase().split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    const scale = fraction.length - Number(exponent);
    const coefficient = BigInt(whole + fraction);
    return scale >= 0 ? [coefficient, 10n ** BigInt(scale)] : [coefficient * 10n ** BigInt(-scale), 1n];
  };
  const [amount, amountScale] = decimal(value), [exchange, exchangeScale] = decimal(rate);
  const scale = 10n ** BigInt(digits), denominator = amountScale * exchangeScale;
  const minor = (amount * exchange * scale * 2n + denominator) / (denominator * 2n);
  if(minor > BigInt(Number.MAX_SAFE_INTEGER))throw Error('Price bound is too large');
  return Number(minor) / Number(scale);
}
