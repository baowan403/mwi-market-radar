import type {CandidateRequest} from './candidate-runner';
import {buildStrategyCandidates} from './candidates';
import {createStrategyPriceBook} from './price-book';
self.onmessage=(event:MessageEvent<CandidateRequest>)=>{
  try{
    const {profile,data,snapshot}=event.data;
    self.postMessage({result:buildStrategyCandidates({profile,data,prices:createStrategyPriceBook(snapshot,data)})});
  }catch{self.postMessage({error:true});}
};
