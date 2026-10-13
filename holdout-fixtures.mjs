// Frozen after the explicit ambiguity guard; do not tune the model on these results.
export const HOLDOUT_FIXTURES = [
  {name:'new catalogue terminology',headers:['catalog reference','display name','unit sale price','ISO currency code'],expected:[0,1,2,3]},
  {name:'new shuffled terminology',headers:['payment currency','asking price','listing title','item reference'],expected:[3,2,1,0]},
  {name:'cost versus sale',headers:['item id','name','wholesale cost','retail price','currency code'],expected:[0,1,null,4]},
  {name:'unrelated fulfilment sheet',headers:['dispatch date','delivery city','customer phone','parcel dimensions'],expected:[null,null,null,null]},
];
