# HODLWARZ

A real-time token holder battle royale on Solana. Every holder is a bubble. Bubbles auto-fight, earn XP from kills and holding, and level up with more HP and damage. All data is live on-chain.

![HODLWARZ](https://via.placeholder.com/800x400?text=HODLWARZ+Preview)

## Features

- **Live Bubble Animation**: Physics-based simulation using D3.js force simulation
- **Interactive Bubbles**: Click on any bubble to see detailed holder information
- **Collision Detection**: Bubbles bounce off each other and walls realistically
- **Size-based Visualization**: Bubble size represents percentage of token holdings
- **Color Coding**: Different colors for whales, large, medium, and small holders
- **Beautiful UI**: Modern glassmorphism design with smooth animations

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn/ui (custom implementation)
- **Physics**: D3.js Force Simulation
- **Animations**: Framer Motion
- **Data**: Helius API / Mock data for development

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/hodlwarz.git
cd hodlwarz
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

4. Edit `.env.local` and add your API keys:
```env
# Required for real data - get your key at https://helius.dev
HELIUS_API_KEY=your_helius_api_key_here

# Optional: Default token to display
DEFAULT_TOKEN_ADDRESS=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HELIUS_API_KEY` | Yes* | API key from [Helius](https://helius.dev) for fetching Solana data |
| `DEFAULT_TOKEN_ADDRESS` | No | Default token to display (defaults to USDC) |
| `MAX_HOLDERS_DISPLAY` | No | Maximum number of holders to show (default: 100) |
| `REFRESH_INTERVAL_MS` | No | Auto-refresh interval in ms (default: 30000) |

*Without an API key, the app will use mock data for demonstration.

## API Data Sources

The app supports multiple data sources:

1. **Helius API** (Recommended)
   - Fast and reliable
   - Free tier: 100k credits/month
   - Get your key at: https://helius.dev

2. **Mock Data** (Default without API key)
   - Generates realistic distribution for testing
   - No API key required

## Project Structure

```
src/
├── app/
│   ├── api/holders/route.ts  # API endpoint for holder data
│   ├── globals.css           # Global styles
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Main page
├── components/
│   ├── bubble-map/
│   │   ├── BubbleCanvas.tsx  # Canvas rendering
│   │   ├── BubbleMap.tsx     # Main component
│   │   ├── HolderModal.tsx   # Holder detail modal
│   │   ├── types.ts          # TypeScript types
│   │   └── index.ts          # Exports
│   ├── ui/                   # shadcn/ui components
│   └── TokenSearch.tsx       # Token search component
├── hooks/
│   └── useBubbleSimulation.ts # D3 force simulation hook
└── lib/
    └── utils.ts              # Utility functions
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for your own purposes.

## Acknowledgments

- [D3.js](https://d3js.org/) for the incredible force simulation
- [Helius](https://helius.dev/) for Solana API access
- [shadcn/ui](https://ui.shadcn.com/) for UI component inspiration
- [Bubblemaps](https://bubblemaps.io/) for the original concept inspiration
