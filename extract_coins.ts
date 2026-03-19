import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

const ADMIN_KEY = process.env.ADMIN_PRIVATE_KEY!;
const NEW_PACKAGE_ID = '0x95432fe09ab4d17afeb874366fbb611d625bfabe3cbcae75dd07b328c5951ac7';
const BETTING_PLATFORM_ID = '0xfed2649741e4d3f6316434d6bdc51d0d0975167a0dc87447122d04830d59fdf9';
const ADMIN_CAP_ID = '0xe1e5fd1e5077a78bb3a8fd28bf096f32b0e031213974239ebee1dd80afcfae61';
const SBETS_TYPE = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const keypair = Ed25519Keypair.fromSecretKey(ADMIN_KEY);
  
  console.log('Admin address:', keypair.toSuiAddress());
  
  const coins = await client.getCoins({
    owner: BETTING_PLATFORM_ID,
    coinType: SBETS_TYPE,
  });
  
  console.log(`Found ${coins.data.length} stuck SBETS coin objects`);
  let totalBalance = BigInt(0);
  for (const c of coins.data) {
    totalBalance += BigInt(c.balance);
    console.log(`  ${c.coinObjectId} = ${(Number(BigInt(c.balance)) / 1e9).toLocaleString()} SBETS`);
  }
  console.log(`Total stuck: ${(Number(totalBalance) / 1e9).toLocaleString()} SBETS\n`);
  
  let totalExtracted = BigInt(0);
  let successCount = 0;
  
  // Process one coin at a time to be safe
  for (let i = 0; i < coins.data.length; i++) {
    const coin = coins.data[i];
    const sbets = Number(BigInt(coin.balance)) / 1e9;
    console.log(`[${i+1}/${coins.data.length}] Extracting ${sbets.toLocaleString()} SBETS (${coin.coinObjectId.slice(0,16)}...)`);
    
    const tx = new Transaction();
    
    tx.moveCall({
      target: `${NEW_PACKAGE_ID}::betting::receive_sbets_coins`,
      arguments: [
        tx.object(ADMIN_CAP_ID),
        tx.object(BETTING_PLATFORM_ID),
        tx.receivingRef({
          objectId: coin.coinObjectId,
          version: coin.version,
          digest: coin.digest,
        }),
      ],
    });
    
    tx.setGasBudget(50_000_000);
    
    try {
      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });
      
      if (result.effects?.status?.status === 'success') {
        totalExtracted += BigInt(coin.balance);
        successCount++;
        console.log(`  ✅ TX: ${result.digest}`);
      } else {
        console.log(`  ❌ Failed: ${result.effects?.status?.error}`);
        console.log(`  TX: ${result.digest}`);
      }
    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message?.slice(0, 200)}`);
    }
    
    // Wait between transactions
    if (i < coins.data.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  
  console.log(`\n=== EXTRACTION COMPLETE ===`);
  console.log(`Coins extracted: ${successCount}/${coins.data.length}`);
  console.log(`Total SBETS extracted: ${(Number(totalExtracted) / 1e9).toLocaleString()} SBETS`);
}

main().catch(console.error);
