const fs = require('fs');
const path = 'src/app/pages/MistakeBookPage.tsx';
let content = fs.readFileSync(path, 'utf8');

const startIndex = content.indexOf('<div \n                        className="flex flex-wrap gap-2.5 min-h-[40px] p-1.5 -m-1.5 rounded-xl transition-all duration-200 border-2 border-transparent"');
const endIndexStr = `{isGlobalEditing && (
                          <AddTagBox onAdd={(tag) => {
                             try {
                               registerCustomKnowledgeTaxonomy(tag, category, l2, subject);
                               approveNewTags({ knowledge_point: [tag] });
                               setTagVersion(v => v + 1);
                             } catch (e:any) { toast.error(e.message); }
                          }} />
                        )}
                      </div>`;
const endIndex = content.indexOf(endIndexStr);

if (startIndex !== -1 && endIndex !== -1) {
  const oldBlock = content.substring(startIndex, endIndex + endIndexStr.length);

  const newBlock = `<div className="flex flex-col gap-6 pt-2 pb-2">
                        {[
                          { id: 'red', label: '待攻克 (红)', nodes: nodesArray.filter(n => n.status === 'red') },
                          { id: 'orange', label: '巩固中 (橙)', nodes: nodesArray.filter(n => n.status === 'orange') },
                          { id: 'green', label: '已掌握 (绿)', nodes: nodesArray.filter(n => n.status === 'green' || n.status === 'gray') }
                        ].map(group => group.nodes.length > 0 || (isGlobalEditing && group.id === 'green') ? (
                          <div key={group.id} className="space-y-2">
                            <ReactSortable
                              list={group.nodes}
                              setList={(newState) => {
                                if (JSON.stringify(newState.map(n => n.node)) === JSON.stringify(group.nodes.map(n => n.node))) return;
                                
                                setSortConfig(prev => {
                                  const groupKey = \`\${subject}-\${category}-\${l2}-\${group.id}\`;
                                  return {
                                    ...prev,
                                    [groupKey]: newState.map(n => n.node)
                                  };
                                });
                              }}
                              group={{ name: \`\${category}-\${l2}-\${group.id}\`, pull: false, put: false }}
                              animation={200}
                              disabled={false} // Always sortable within group
                              className="flex flex-wrap gap-2.5 min-h-[40px] p-1.5 -m-1.5 rounded-xl transition-all duration-300 border-2 border-transparent"
                            >
                              {(() => {
                                const groupKey = \`\${subject}-\${category}-\${l2}-\${group.id}\`;
                                const savedOrder = sortConfig[groupKey] || [];
                                const sortedGroupNodes = [...group.nodes].sort((a, b) => {
                                  const idxA = savedOrder.indexOf(a.node);
                                  const idxB = savedOrder.indexOf(b.node);
                                  if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                                  if (idxA !== -1) return -1;
                                  if (idxB !== -1) return 1;
                                  return 0;
                                });

                                return sortedGroupNodes.map(({ node, status, list }) => {
                                  let buttonClasses = '';
                                  if (list.length === 0) {
                                    buttonClasses = 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100';
                                  } else if (status === 'red') {
                                    buttonClasses = 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100';
                                  } else if (status === 'orange') {
                                    buttonClasses = 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100';
                                  } else {
                                    buttonClasses = 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
                                  }

                                  if (isGlobalEditing) {
                                    return (
                                      <EditableTag
                                        key={node}
                                        node={node}
                                        buttonClasses={buttonClasses}
                                        onRename={(newVal) => executeRenameNodeTag(node, newVal)}
                                        onDelete={() => executeDeleteNodeTag(node)}
                                        onDragStart={() => {}}
                                      />
                                    );
                                  }

                                  return (
                                    <button
                                      key={node}
                                      type="button"
                                      onClick={() => navigate(\`/questions/node?subject=\${encodeURIComponent(subject)}&category=\${encodeURIComponent(category)}&l2=\${encodeURIComponent(l2)}&node=\${encodeURIComponent(node)}\`, { state: { subject, category, l2, node } })}
                                      className={\`inline-flex items-center px-3 py-1.5 rounded-xl border text-xs font-bold transition-all duration-300 shadow-sm hover:-translate-y-0.5 active:scale-95 cursor-pointer \${buttonClasses}\`}
                                      title="点击查看错题"
                                    >
                                      {node}
                                    </button>
                                  );
                                });
                              })()}
                            </ReactSortable>
                            
                            {isGlobalEditing && group.id === 'green' && (
                              <div className="pt-1">
                                <AddTagBox onAdd={(tag) => {
                                   try {
                                     registerCustomKnowledgeTaxonomy(tag, category, l2, subject);
                                     approveNewTags({ knowledge_point: [tag] });
                                     setTagVersion(v => v + 1);
                                   } catch (e:any) { toast.error(e.message); }
                                }} />
                              </div>
                            )}
                          </div>
                        ) : null)}
                      </div>`;

  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Replacement successful!');
} else {
  console.log('Could not find the block.');
}
