import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Wallet, Coins, Trophy, Chrome, Shield, Fingerprint } from 'lucide-react';
import Layout from '@/components/layout/Layout';
import { WalletConnector } from '@/components/wallet/WalletConnector';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

export default function JoinPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const handleWalletConnect = (address: string) => {
    console.log('Wallet connected:', address);
    toast({
      title: "Welcome to SuiBets!",
      description: "Your wallet has been connected successfully. Start betting now!",
    });
    setLocation('/home-real');
  };

  if (user) {
    setLocation('/home-real');
    return null;
  }

  return (
    <Layout title="Join SuiBets">
      <div className="min-h-screen bg-gradient-to-br from-[#0b1618] via-[#112225] to-[#1a3138] py-8">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-cyan-400 mb-4">
              Welcome to SuiBets
            </h1>
            <p className="text-xl text-gray-300 mb-6">
              Join the future of sports betting on the Sui blockchain
            </p>
            <div className="flex justify-center space-x-8 text-sm text-cyan-300">
              <div className="flex items-center">
                <Trophy className="h-5 w-5 mr-2" />
                2% Protocol Fee
              </div>
              <div className="flex items-center">
                <Coins className="h-5 w-5 mr-2" />
                Instant Payouts
              </div>
              <div className="flex items-center">
                <Wallet className="h-5 w-5 mr-2" />
                Blockchain Security
              </div>
            </div>
          </div>

          <Tabs defaultValue="wallet" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-[#1e3a3f] border-[#2a4a4f]">
              <TabsTrigger
                value="wallet"
                className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
              >
                <Wallet className="h-4 w-4 mr-2" />
                Sui Wallet
              </TabsTrigger>
              <TabsTrigger
                value="zklogin"
                className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
              >
                <Chrome className="h-4 w-4 mr-2" />
                Google via zkLogin
              </TabsTrigger>
            </TabsList>

            <TabsContent value="wallet" className="mt-6">
              <Card className="bg-[#0b1618] border-[#1e3a3f] text-white">
                <CardHeader className="text-center">
                  <CardTitle className="text-2xl text-cyan-400">Connect Your Sui Wallet</CardTitle>
                  <CardDescription className="text-gray-400">
                    The fastest way to start betting. Your wallet is your account.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="text-center">
                    <WalletConnector onConnect={handleWalletConnect} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
                    <div className="text-center p-4 bg-[#112225] rounded-lg border border-[#1e3a3f]">
                      <Wallet className="h-8 w-8 text-cyan-400 mx-auto mb-2" />
                      <h3 className="font-semibold text-cyan-300">No Deposits</h3>
                      <p className="text-sm text-gray-400">Bet directly from your wallet</p>
                    </div>
                    <div className="text-center p-4 bg-[#112225] rounded-lg border border-[#1e3a3f]">
                      <Trophy className="h-8 w-8 text-cyan-400 mx-auto mb-2" />
                      <h3 className="font-semibold text-cyan-300">Instant Wins</h3>
                      <p className="text-sm text-gray-400">Automatic payouts to wallet</p>
                    </div>
                    <div className="text-center p-4 bg-[#112225] rounded-lg border border-[#1e3a3f]">
                      <Coins className="h-8 w-8 text-cyan-400 mx-auto mb-2" />
                      <h3 className="font-semibold text-cyan-300">Earn Dividends</h3>
                      <p className="text-sm text-gray-400">Stake SBETS for rewards</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="zklogin" className="mt-6">
              <Card className="bg-[#0b1618] border-[#1e3a3f] text-white">
                <CardHeader className="text-center">
                  <CardTitle className="text-2xl text-cyan-400">Sign in with Google</CardTitle>
                  <CardDescription className="text-gray-400">
                    zkLogin derives a real Sui address from your Google account — no seed phrase, no extension.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-[#112225] rounded-lg border border-[#1e3a3f]">
                      <Chrome className="h-8 w-8 text-cyan-400 mx-auto mb-2" />
                      <h3 className="font-semibold text-cyan-300">Google OAuth</h3>
                      <p className="text-sm text-gray-400">Your Google JWT creates a ZK proof — your identity stays private</p>
                    </div>
                    <div className="text-center p-4 bg-[#112225] rounded-lg border border-[#1e3a3f]">
                      <Shield className="h-8 w-8 text-cyan-400 mx-auto mb-2" />
                      <h3 className="font-semibold text-cyan-300">Real Sui Address</h3>
                      <p className="text-sm text-gray-400">You get a native on-chain address — not a custodial account</p>
                    </div>
                    <div className="text-center p-4 bg-[#112225] rounded-lg border border-[#1e3a3f]">
                      <Fingerprint className="h-8 w-8 text-cyan-400 mx-auto mb-2" />
                      <h3 className="font-semibold text-cyan-300">Gas Sponsored</h3>
                      <p className="text-sm text-gray-400">SuiBets sponsors gas for USDC users — zero SUI needed to start</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border text-sm text-gray-400 text-center"
                    style={{ background: 'rgba(0,255,255,0.04)', borderColor: 'rgba(0,255,255,0.12)' }}>
                    <p className="text-cyan-300 font-semibold mb-1">How it works</p>
                    <p>Sign in with Google → Sui generates a ZK proof → You receive a persistent Sui wallet address → Bet immediately. Google never sees your on-chain activity.</p>
                  </div>

                  <div className="text-center">
                    <WalletConnector onConnect={handleWalletConnect} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </Layout>
  );
}
