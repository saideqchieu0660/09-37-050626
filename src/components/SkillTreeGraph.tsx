import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useTheme } from './ThemeProvider';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { Lock, Unlock, CheckCircle2 } from 'lucide-react';

interface NodeData extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  subject: string;
  mastery: number;
  status: 'locked' | 'unlocked' | 'mastered';
}

interface LinkData extends d3.SimulationLinkDatum<NodeData> {
  source: string | NodeData;
  target: string | NodeData;
}

interface SkillTreeProps {
  decks: any[];
}

const PREREQUISITES: Record<string, string[]> = {
  'deck_phil_2': ['deck_1'],
  'deck_math_2': ['deck_math_1'],
  'deck_physics_2': ['deck_physics_1'],
};

export const SkillTreeGraph = React.memo(function SkillTreeGraph({ decks }: SkillTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);

  useEffect(() => {
    if (!containerRef.current || decks.length === 0) return;

    // Calculate node states
    const nodeMap = new Map<string, NodeData>();
    
    decks.forEach(deck => {
      const avgMastery = deck.cards.length 
        ? deck.cards.reduce((sum: number, c: any) => sum + c.mastery, 0) / deck.cards.length 
        : 0;
      
      nodeMap.set(deck.id, {
        id: deck.id,
        title: deck.title,
        subject: deck.subject,
        mastery: avgMastery,
        status: 'locked' // default
      });
    });

    const nodesData = Array.from(nodeMap.values());
    
    // Evaluate status based on prerequisites
    nodesData.forEach(node => {
      if (node.mastery >= 80) {
        node.status = 'mastered';
      } else {
        const prereqs = PREREQUISITES[node.id] || [];
        const isUnlocked = prereqs.every(pid => {
          const pNode = nodeMap.get(pid);
          return pNode && pNode.mastery >= 80;
        });
        node.status = isUnlocked ? 'unlocked' : 'locked';
      }
    });

    const linksData: LinkData[] = [];
    Object.entries(PREREQUISITES).forEach(([targetId, sourceIds]) => {
      sourceIds.forEach(sourceId => {
        if (nodeMap.has(sourceId) && nodeMap.has(targetId)) {
          linksData.push({ source: sourceId, target: targetId });
        }
      });
    });

    const renderGraph = (width: number, height: number) => {
      d3.select(containerRef.current).select('svg').remove();

      const svg = d3.select(containerRef.current)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .call(d3.zoom<SVGSVGElement, unknown>().on('zoom', (event) => {
          g.attr('transform', event.transform);
        }))
        .append('g');

      const g = svg.append('g');

      const simulation = d3.forceSimulation<NodeData>(nodesData)
        .force('link', d3.forceLink<NodeData, LinkData>(linksData).id(d => d.id).distance(150))
        .force('charge', d3.forceManyBody().strength(-800))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(60));

      // Draw links
      const link = g.append('g')
        .attr('stroke', theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)')
        .attr('stroke-opacity', 0.6)
        .selectAll('line')
        .data(linksData)
        .join('line')
        .attr('stroke-width', 3)
        .attr('stroke', d => {
          const sourceNode = typeof d.source === 'string' ? nodeMap.get(d.source) : d.source;
          if (sourceNode && sourceNode.status === 'mastered') {
             return '#eab308'; // glowing yellow for unlocked paths
          }
          return theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
        });

      // Node groups
      const node = g.append('g')
        .selectAll('g')
        .data(nodesData)
        .join('g')
        .style('cursor', d => d.status === 'locked' ? 'not-allowed' : 'pointer')
        .call(d3.drag<SVGGElement, NodeData>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
        )
        .on('click', (event, d) => {
           if (d.status !== 'locked') {
               setSelectedNode(d);
           }
        });

      // Glow effect defs
      const defs = svg.append("defs");
      const filter = defs.append("filter")
          .attr("id", "glow");
      filter.append("feGaussianBlur")
          .attr("stdDeviation", "8")
          .attr("result", "coloredBlur");
      const feMerge = filter.append("feMerge");
      feMerge.append("feMergeNode")
          .attr("in", "coloredBlur");
      feMerge.append("feMergeNode")
          .attr("in", "SourceGraphic");

      // Node circles
      node.append('circle')
        .attr('r', 40)
        .attr('fill', d => {
          if (d.status === 'mastered') return '#eab308'; // Gold
          if (d.status === 'unlocked') return theme === 'dark' ? '#3f3f46' : '#e4e4e7'; 
          return theme === 'dark' ? '#18181b' : '#f4f4f5'; // Locked
        })
        .attr('stroke', d => {
          if (d.status === 'mastered') return '#ca8a04';
          if (d.status === 'unlocked') return '#eab308';
          return theme === 'dark' ? '#3f3f46' : '#e4e4e7';
        })
        .attr('stroke-width', d => d.status === 'unlocked' ? 4 : 2)
        .style('filter', d => (d.status === 'mastered' || d.status === 'unlocked') ? 'url(#glow)' : 'none');

      // Node Icons or Text (center)
      node.append('text')
        .text(d => {
           if (d.status === 'locked') return '🔒';
           if (d.status === 'mastered') return '⭐';
           return `${Math.round(d.mastery)}%`;
        })
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('font-size', '20px')
        .attr('fill', d => {
           if (d.status === 'mastered') return '#000';
           return theme === 'dark' ? '#fff' : '#000';
        });

      // Node Title (below)
      node.append('text')
        .text(d => d.title)
        .attr('text-anchor', 'middle')
        .attr('dy', '60px')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
        .attr('fill', d => {
           if (d.status === 'locked') return theme === 'dark' ? '#52525b' : '#a1a1aa';
           return theme === 'dark' ? '#e4e4e7' : '#27272a';
        });

      simulation.on('tick', () => {
        link
          .attr('x1', d => (d.source as NodeData).x!)
          .attr('y1', d => (d.source as NodeData).y!)
          .attr('x2', d => (d.target as NodeData).x!)
          .attr('y2', d => (d.target as NodeData).y!);

        node.attr('transform', d => `translate(${d.x},${d.y})`);
      });

      return () => {
         simulation.stop();
      };
    };

    let resizeTimer: NodeJS.Timeout;
    const observer = new ResizeObserver((entries) => {
       if (entries.length === 0) return;
       const { width } = entries[0].contentRect;
       if (width === 0) return;
       clearTimeout(resizeTimer);
       resizeTimer = setTimeout(() => {
           renderGraph(width, 500); // fixed height for now
       }, 50);
    });

    observer.observe(containerRef.current);

    return () => {
        observer.disconnect();
        clearTimeout(resizeTimer);
    };

  }, [decks, theme]);

  return (
    <div className="relative w-full h-[500px] rounded-xl overflow-hidden glass">
       <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
       
       {selectedNode && (
         <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/90 dark:bg-black/90 backdrop-blur-md p-6 rounded-xl border border-amber-500/30 shadow-2xl flex flex-col items-center min-w-[300px] animate-in slide-in-from-bottom-5">
            <h3 className="text-xl font-bold font-display text-transparent bg-clip-text bg-gradient-to-r from-amber-700 to-yellow-600 dark:from-amber-200 dark:to-yellow-500 mb-2">
              {selectedNode.title}
            </h3>
            <div className="flex gap-4 w-full mb-4">
              <div className="flex-1 bg-black/5 dark:bg-white/5 rounded-lg p-3 text-center">
                 <div className="text-sm opacity-60">Độ thông thạo</div>
                 <div className="text-2xl font-bold">{Math.round(selectedNode.mastery)}%</div>
              </div>
              <div className="flex-1 bg-black/5 dark:bg-white/5 rounded-lg p-3 text-center flex flex-col items-center justify-center">
                 <div className="text-sm opacity-60">Trạng thái</div>
                 <div className="text-sm font-bold mt-1 flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                    {selectedNode.status === 'mastered' ? <><CheckCircle2 className="w-4 h-4" /> Đã làm chủ</> : <><Unlock className="w-4 h-4"/> Mở khóa</>}
                 </div>
              </div>
            </div>
            
            <div className="flex gap-3 w-full">
              <button onClick={() => setSelectedNode(null)} className="flex-1 px-4 py-2 rounded-lg font-bold bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition">Đóng</button>
              <button onClick={() => navigate(`/study/${selectedNode.id}`)} className="flex-1 px-4 py-2 rounded-lg font-bold bg-yellow-500 text-black hover:bg-yellow-600 transition shadow-lg shrink-0">Học Ngay</button>
            </div>
         </div>
       )}

       <div className="absolute top-4 left-4 flex gap-3 text-xs font-mono font-bold bg-white/50 dark:bg-black/50 backdrop-blur-md p-2 rounded-lg border border-black/10 dark:border-white/10 pointer-events-none">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-yellow-500"></span> Mastered</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border-2 border-yellow-500"></span> Unlocked</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-stone-300 dark:bg-zinc-800"></span> Locked</div>
       </div>
    </div>
  );
});
