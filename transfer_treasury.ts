import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// Contract IDs
const OLD_PACKAGE_ID = '0x936e79b406296551171bc148b0e1fe7d32534c446a93f5a18766569d8cc736a6';
const OLD_PLATFORM_ID = '0x94a14c61edc4e51b39775b811f42c8a8af96488005af9179315ddb80389f480b';
const OLD_ADMIN_CAP_ID = '0x2b4ace9a99fc6ccc09695cf58b6a317be6f219d76a22e1f099bd505141e270ee';

const NEW_PACKAGE_ID = '0x95432fe09ab4d17afeb874366fbb611d625bfabe3cbcae75dd07b328c5951ac7';
const NEW_PLATFORM_ID = '0xfed2649741e4d3f6316434d6bdc51d0d0975167a0dc87447122d04830d59fdf9';

const SBETS_PACKAGE_ID = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502';
const SBETS_COIN_TYPE = `${SBETS_PACKAGE_ID}::sbets::SBETS`;

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  // Get admin keypair
  const privateKey = process.env.ADMIN_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('ADMIN_PRIVATE_KEY not set');
  }
  
  const { secretKey } = decodeSuiPrivateKey(privateKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const adminAddress = keypair.getPublicKey().toSuiAddress();
  
  console.log('Admin address:', adminAddress);
  
  // Check old platform treasury
  const oldPlatform = await client.getObject({
    id: OLD_PLATFORM_ID,
    options: { showContent: true }
  });
  
  console.log('Old platform:', JSON.stringify(oldPlatform, null, 2));
  
  if (oldPlatform.data?.content?.dataType === 'moveObject') {
    const fields = (oldPlatform.data.content as any).fields;
    const treasurySui = parseInt(fields.treasury_sui) / 1e9;
    const treasurySbets = parseInt(fields.treasury_sbets) / 1e9;
    
    console.log(`\nOld Treasury:`);
    console.log(`  SUI: ${treasurySui} SUI (${fields.treasury_sui} MIST)`);
    console.log(`  SBETS: ${treasurySbets} SBETS (${fields.treasury_sbets} raw)`);
    
    if (parseInt(fields.treasury_sui) > 0) {
      console.log('\n=== WITHDRAWING SUI FROM OLD CONTRACT ===');
      
      const tx = new Transaction();
      
      // Withdraw SUI from old contract
      tx.moveCall({
        target: `${OLD_PACKAGE_ID}::betting::withdraw_fees`,
        arguments: [
          tx.object(OLD_ADMIN_CAP_ID),
          tx.object(OLD_PLATFORM_ID),
          tx.pure.u64(fields.treasury_sui),
        ],
      });
      
      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true }
      });
      
      console.log('Withdraw SUI TX:', result.digest);
      console.log('Status:', result.effects?.status);
      
      // Wait a moment
      await new Promise(r => setTimeout(r, 2000));
    }
    
    if (parseInt(fields.treasury_sbets) > 0) {
      console.log('\n=== WITHDRAWING SBETS FROM OLD CONTRACT ===');
      
      const tx = new Transaction();
      
      // Withdraw SBETS from old contract  
      tx.moveCall({
        target: `${OLD_PACKAGE_ID}::betting::withdraw_fees_sbets`,
        typeArguments: [SBETS_COIN_TYPE],
        arguments: [
          tx.object(OLD_ADMIN_CAP_ID),
          tx.object(OLD_PLATFORM_ID),
          tx.pure.u64(fields.treasury_sbets),
        ],
      });
      
      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true }
      });
      
      console.log('Withdraw SBETS TX:', result.digest);
      console.log('Status:', result.effects?.status);
      
      // Wait a moment
      await new Promise(r => setTimeout(r, 2000));
    }
    
    // Now deposit to new contract
    console.log('\n=== DEPOSITING TO NEW CONTRACT ===');
    
    // Get wallet balance
    const balance = await client.getBalance({ owner: adminAddress });
    console.log('Admin SUI balance:', parseInt(balance.totalBalance) / 1e9, 'SUI');
    
    // Get SUI coins
    const suiCoins = await client.getCoins({ owner: adminAddress, coinType: '0x2::sui::SUI' });
    console.log('SUI coins:', suiCoins.data.length);
    
    // Get SBETS coins
    const sbetsCoins = await client.getCoins({ owner: adminAddress, coinType: SBETS_COIN_TYPE });
    console.log('SBETS coins:', sbetsCoins.data.length);
    
    let totalSbets = 0n;
    for (const coin of sbetsCoins.data) {
      totalSbets += BigInt(coin.balance);
    }
    console.log('Total SBETS:', Number(totalSbets) / 1e9, 'SBETS');
    
    // Deposit SUI to new contract (keep 0.1 SUI for gas)
    const suiToDeposit = BigInt(balance.totalBalance) - 100000000n; // Keep 0.1 SUI
    
    if (suiToDeposit > 0n) {
      console.log(`\nDepositing ${Number(suiToDeposit) / 1e9} SUI to new contract...`);
      
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(suiToDeposit)]);
      
      tx.moveCall({
        target: `${NEW_PACKAGE_ID}::betting::deposit_sui`,
        arguments: [
          tx.object(NEW_PLATFORM_ID),
          coin,
        ],
      });
      
      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true }
      });
      
      console.log('Deposit SUI TX:', result.digest);
      console.log('Status:', result.effects?.status);
    }
    
    // Deposit SBETS to new contract
    if (totalSbets > 0n) {
      console.log(`\nDepositing ${Number(totalSbets) / 1e9} SBETS to new contract...`);
      
      const tx = new Transaction();
      
      // Merge all SBETS coins if needed
      if (sbetsCoins.data.length > 1) {
        const primaryCoin = tx.object(sbetsCoins.data[0].coinObjectId);
        for (let i = 1; i < sbetsCoins.data.length; i++) {
          tx.mergeCoins(primaryCoin, [tx.object(sbetsCoins.data[i].coinObjectId)]);
        }
        
        tx.moveCall({
          target: `${NEW_PACKAGE_ID}::betting::deposit_sbets`,
          typeArguments: [SBETS_COIN_TYPE],
          arguments: [
            tx.object(NEW_PLATFORM_ID),
            primaryCoin,
          ],
        });
      } else if (sbetsCoins.data.length === 1) {
        tx.moveCall({
          target: `${NEW_PACKAGE_ID}::betting::deposit_sbets`,
          typeArguments: [SBETS_COIN_TYPE],
          arguments: [
            tx.object(NEW_PLATFORM_ID),
            tx.object(sbetsCoins.data[0].coinObjectId),
          ],
        });
      }
      
      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true }
      });
      
      console.log('Deposit SBETS TX:', result.digest);
      console.log('Status:', result.effects?.status);
    }
    
    // Check new platform treasury
    await new Promise(r => setTimeout(r, 2000));
    
    const newPlatform = await client.getObject({
      id: NEW_PLATFORM_ID,
      options: { showContent: true }
    });
    
    if (newPlatform.data?.content?.dataType === 'moveObject') {
      const newFields = (newPlatform.data.content as any).fields;
      console.log(`\n=== NEW TREASURY BALANCE ===`);
      console.log(`  SUI: ${parseInt(newFields.treasury_sui) / 1e9} SUI`);
      console.log(`  SBETS: ${parseInt(newFields.treasury_sbets) / 1e9} SBETS`);
    }
  }
}

main().catch(console.error);
