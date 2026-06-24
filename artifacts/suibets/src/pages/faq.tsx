import { useState } from 'react';
import { Link } from 'wouter';
import { ChevronDown } from 'lucide-react';
import { useCurrentAccount } from '@/lib/dapp-kit-compat';
import SuiNSName from '@/components/SuiNSName';

const FAQS = [
  {
    q: 'What is a peer-to-peer bet?',
    a: 'A P2P bet is a direct wager between two wallets — no bookmaker in the middle. You post an offer with your stake and odds; someone takes the other side. The smart contract holds both stakes until the result is settled on-chain.',
  },
  {
    q: 'If I take a bet, what exactly do I win on?',
    a: "You win if the outcome you backed is the official result. The contract pays out instantly — your winnings (minus the 2% protocol fee) land in your wallet the moment the oracle confirms the result.",
  },
  {
    q: 'Do I need a crypto wallet to start?',
    a: 'Yes. Connect any Sui-compatible wallet — Slush, Nightly, Suiet, or any wallet following the Sui Wallet Standard. No account, no email, no KYC. Your wallet is your identity.',
  },
  {
    q: 'SUI or SBETS — what\'s the difference?',
    a: 'SUI is the native gas token of the Sui network and the primary betting currency. SBETS is the SuiBets platform token — stake it to earn a share of protocol fees, use it to bet directly, or vote on governance parameters.',
  },
  {
    q: 'Who holds my money?',
    a: 'Nobody — the smart contract does. Funds are locked in a shared on-chain object the moment an offer is matched. Neither SuiBets nor any third party can touch them. Only the contract logic can release them to the winner.',
  },
  {
    q: 'How does a bet settle?',
    a: 'An authorised oracle posts the final result on-chain. The contract compares the result to each active offer and automatically pays the winner. Settlement typically happens within minutes of the final whistle.',
  },
  {
    q: 'Is betting legal for me?',
    a: 'That depends on your jurisdiction. SuiBets is a non-custodial protocol — the contract is permissionless. It is your responsibility to comply with the laws of your country. Do not use SuiBets where online betting is prohibited.',
  },
];

function Accordion({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-5 text-left gap-4 transition-colors"
      >
        <span className="text-sm font-bold text-white">{q}</span>
        <ChevronDown
          size={16}
          className="flex-shrink-0 transition-transform duration-200 text-gray-500"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: open ? '#00ffff' : '' }}
        />
      </button>
      {open && (
        <p className="pb-5 text-sm leading-relaxed" style={{ color: '#6b7280' }}>{a}</p>
      )}
    </div>
  );
}

export default function FAQPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address;
  const shortAddr = walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : null;

  const handleConnectWallet = () => {
    window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
  };

  return (
    <div className="min-h-screen bg-[#080a0f] text-white" data-testid="faq-page">

      {/* ── NAV ── */}
      <nav className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] sticky top-0 z-50 bg-[#080a0f]/95 backdrop-blur-md">
        <Link href="/">
          <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-8 w-auto" />
        </Link>
        <div className="flex items-center gap-3">
          {walletAddress ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <SuiNSName address={walletAddress} className="text-cyan-400 font-bold" />
              {' '}<span className="text-gray-600">{shortAddr}</span>
            </div>
          ) : (
            <button
              onClick={handleConnectWallet}
              className="text-sm font-bold px-4 py-2 rounded-xl text-black transition-all hover:opacity-90"
              style={{ background: '#00ffff' }}
            >
              Connect wallet
            </button>
          )}
          <Link href="/"
            className="text-sm font-medium px-4 py-2 rounded-xl transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: '#9ca3af' }}
          >
            ← Home
          </Link>
        </div>
      </nav>

      <div className="px-5 py-10" style={{ maxWidth: 680, margin: '0 auto' }}>

        {/* Heading */}
        <h1 className="text-5xl font-black mb-8">
          F<em className="not-italic text-cyan-400" style={{ fontStyle: 'italic' }}>AQ</em>
        </h1>

        {/* Accordion */}
        <div className="border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          {FAQS.map((item, i) => (
            <Accordion
              key={i}
              q={item.q}
              a={item.a}
              open={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? null : i)}
            />
          ))}
        </div>

        {/* Community links */}
        <div className="mt-10 flex items-center gap-4">
          <a
            href="https://t.me/Sui_Bets"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-black transition-all hover:opacity-90"
            style={{ background: '#00ffff' }}
          >
            Telegram
          </a>
          <Link href="/whitepaper"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#9ca3af' }}
          >
            How it works →
          </Link>
        </div>

        <div className="h-16" />
      </div>

      {/* ── FOOTER ── */}
      <footer className="border-t px-5 pt-8 pb-10" style={{ borderColor: 'rgba(255,255,255,0.06)', maxWidth: 680, margin: '0 auto' }}>
        <div className="flex items-center justify-between mb-5">
          <Link href="/">
            <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-6 w-auto opacity-70" />
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black px-2 py-0.5 rounded border" style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#6b7280' }}>18+</span>
            <span className="text-xs" style={{ color: '#6b7280' }}>Play responsibly</span>
          </div>
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-start gap-3">
            <span className="text-gray-600 mt-0.5 flex-shrink-0 text-sm">ⓘ</span>
            <p className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>
              <strong className="text-gray-400">Betting should be fun, never a way to make money.</strong> Only stake what you can afford to lose. If it stops being fun, take a break or reach out to a support service in your country.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mb-5">
          {['How it works', 'FAQ', 'Terms of use', 'Privacy', 'Responsible play'].map(label => (
            <Link key={label} href={`/${label.toLowerCase().replace(/\s+/g, '-')}`}
              className="text-xs transition-colors hover:text-gray-300"
              style={{ color: '#4b5563' }}>
              {label}
            </Link>
          ))}
        </div>

        <p className="text-[11px] leading-relaxed" style={{ color: '#374151' }}>
          <strong className="text-gray-600">Risk warning.</strong> SuiBets is a non-custodial, peer-to-peer betting exchange on the Sui network. Bets are wagers with real value and outcomes are uncertain — you can lose your entire stake. SUI and SBETS are crypto-assets whose value is volatile and may fall as well as rise.
        </p>
        <p className="text-[11px] leading-relaxed mt-2" style={{ color: '#374151' }}>
          <strong className="text-gray-600">Your responsibility.</strong> You control your own wallet and keys; lost keys or signed transactions cannot be reversed by anyone, including us. Always verify what you sign.
        </p>
      </footer>
    </div>
  );
}
