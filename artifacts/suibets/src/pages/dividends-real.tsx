import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import Layout from "@/components/layout/Layout";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DividendsInfo {
  totalStaked: number;
  userStaked: number;
  availableToClaim: number;
  totalDividends: number;
  availableDividends: number;
  claimedDividends: number;
  nextDistribution: string;
  lastClaimTime?: string;
  totalRewards?: number;
  platformFees?: number;
}

export default function DividendsReal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch user dividends info
  const { 
    data: dividendsInfo,
    isLoading,
    refetch
  } = useQuery<DividendsInfo>({
    queryKey: ['/api/wurlus/dividends', user?.walletAddress],
    enabled: !!user?.walletAddress,
  });

  // Handle claim dividends
  const handleClaim = async () => {
    if (!user?.walletAddress || !dividendsInfo?.availableDividends || dividendsInfo.availableDividends <= 0) {
      toast({
        title: "Nothing to claim",
        description: "You don't have any dividends available to claim",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await apiRequest("POST", "/api/wurlus/claim-dividends", {
        walletAddress: user.walletAddress
      });

      if (response.ok) {
        toast({
          title: "Claim successful",
          description: `Successfully claimed ${dividendsInfo.availableDividends.toFixed(4)} SBETS tokens`,
        });
        refetch();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to claim dividends");
      }
    } catch (error: any) {
      toast({
        title: "Claim failed",
        description: error.message || "An error occurred while claiming dividends",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Layout title="SUIBETS DIVIDENDS">
        <div className="flex justify-center items-center h-[50vh]">
          <Loader size="lg" />
        </div>
      </Layout>
    );
  }

  if (!user?.walletAddress) {
    return (
      <Layout title="SUIBETS DIVIDENDS">
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
          <div className="rounded-full bg-gray-800 p-3 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h3 className="text-lg font-medium">Connect Wallet</h3>
          <p className="text-sm text-gray-400 mt-1 mb-4">Connect your wallet to view and manage your dividends</p>
          <Button asChild>
            <a href="/connect-wallet">Connect Wallet</a>
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="SUIBETS DIVIDENDS">
      <div className="max-w-3xl mx-auto">
        <Card className="bg-gray-900 border-gray-700 mb-6">
          <CardContent className="p-6">
          </CardContent>
        </Card>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">WEEKLY DIVIDEND STATS:</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex space-x-2 items-center mb-2">
                <div className="w-6 h-6 bg-black rounded-full flex items-center justify-center">
                  <span className="text-xs">S</span>
                </div>
                <Select defaultValue="SUIBETS">
                  <SelectTrigger className="w-full bg-transparent border-none shadow-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SUIBETS">SUIBETS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-gray-400">Dividend pool</div>
              <div className="text-lg font-semibold mt-1">
                {dividendsInfo?.totalDividends.toLocaleString()} SBETS
              </div>
            </div>
            
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-sm text-gray-400">Estimated Payout per 10k:</div>
              <div className="text-lg font-semibold mt-1">
                {((dividendsInfo?.totalDividends || 0) / (dividendsInfo?.totalStaked || 1) * 10000).toFixed(4)} SBETS
              </div>
            </div>
            
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-sm text-gray-400">Last Payout per 10k:</div>
              <div className="text-lg font-semibold mt-1">
                {dividendsInfo?.lastClaimTime ? 
                  ((dividendsInfo.claimedDividends / dividendsInfo.userStaked) * 10000).toFixed(4) : 
                  "0.0000"} SBETS
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-medium">Available to claim:</h3>
            <div className="text-lg font-semibold">
              {dividendsInfo?.availableDividends.toFixed(4)} SBETS
            </div>
          </div>
          <Button 
            className="w-full" 
            onClick={handleClaim}
            disabled={isSubmitting || !(dividendsInfo?.availableDividends > 0)}
          >
            {isSubmitting ? <Loader size="sm" /> : "Claim Dividends"}
          </Button>
        </div>

        <div className="text-sm text-gray-400 p-4 border-l-2 border-blue-500 bg-gray-800 bg-opacity-40 rounded">
          <p>• Dividends are distributed every Monday before 10 AM UTC</p>
        </div>
      </div>
    </Layout>
  );
}