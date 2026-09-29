import type {WorkerResponse} from '../../../packages/contracts';
export class SimulationClient{
 worker=new Worker(new URL('./sim.worker.ts',import.meta.url),{type:'module'}); generation=0;epoch=0;nextId=1;ready:Promise<unknown>;listeners=new Set<(message:WorkerResponse)=>void>();pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
 constructor(){this.ready=new Promise((resolve,reject)=>{this.worker.onerror=e=>reject(new Error(e.message));this.worker.onmessage=({data}:MessageEvent<WorkerResponse>)=>{this.generation=data.generation;this.epoch=data.epoch;if(data.type==='ready')resolve(data.payload);if(data.type==='result'&&data.requestId){const p=this.pending.get(data.requestId);this.pending.delete(data.requestId);if(data.error)p?.reject(new Error(data.error));else p?.resolve(data.payload);}this.listeners.forEach(fn=>fn(data));};});}
 async request<T=any>(type:string,payload?:unknown,expectedStep?:number):Promise<T>{await this.ready;const requestId=this.nextId++;return new Promise((resolve,reject)=>{this.pending.set(requestId,{resolve,reject});this.worker.postMessage({type,payload,requestId,generation:this.generation,epoch:this.epoch,expectedStep});});}
 subscribe(fn:(message:WorkerResponse)=>void){this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};}
 dispose(){this.worker.terminate();this.pending.forEach(p=>p.reject(new Error('Session closed')));this.pending.clear();}
}
