export function quote({packageType,quantity,paymentPlan}) {
  const totalCents=quantity*(packageType===3?200000:100000)*(paymentPlan==='cash'?9:10)/10;
  return {totalCents,initialCents:paymentPlan==='cash'?totalCents:quantity*10000};
}

export function validatePayment(remote,{paymentId,reference,customerId,amountCents}) {
  if(!/^pay_[A-Za-z0-9]+$/.test(paymentId||'') || remote.id!==paymentId ||
    remote.externalReference!==reference || remote.customer!==customerId ||
    !Number.isFinite(Number(remote.value)) || Number(remote.value)*100!==amountCents ||
    remote.billingType!=='BOLETO' || remote.installment || remote.subscription || remote.deleted)
    throw new Error('Payment identity mismatch');
}
