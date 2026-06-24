import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
const rpc = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('mainnet') });
const TB2_PLATFORM = '0x0b1beb33fdbd405acab159711e033cc59d3d1e2f5d1ab75ecc6f3b740414cb24';
const obj = await rpc.getObject({ id: TB2_PLATFORM, options: { showContent: true } });
const fields = obj.data?.content?.fields;
console.log('oracle_public_key length:', (fields?.oracle_public_key || []).length);
console.log('oracle_public_key hex:', Buffer.from(fields?.oracle_public_key || []).toString('hex'));
console.log('paused:', fields?.paused);
