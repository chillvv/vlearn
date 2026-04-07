const fs = require('fs');
const path = 'src/app/pages/MistakeBookPage.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldStr = `<div className="pt-4 pb-2">
                <div 
                  className="flex flex-wrap gap-x-4 gap-y-5 p-2 -m-2 rounded-xl transition-all duration-200 border-2 border-transparent"
                  onDragOver={(e) => {
                    if (isGlobalEditing && e.dataTransfer.types.includes('application/my-app-node')) {
                      e.preventDefault();
                      e.currentTarget.classList.add('bg-indigo-50/50', 'border-indigo-200', 'border-dashed');
                    }
                  }}
                  onDragLeave={(e) => {
                    if (isGlobalEditing) {
                      e.currentTarget.classList.remove('bg-indigo-50/50', 'border-indigo-200', 'border-dashed');
                    }
                  }}
                  onDrop={(e) => {
                    if (isGlobalEditing && e.dataTransfer.types.includes('application/my-app-node')) {
                      e.preventDefault();
                      e.currentTarget.classList.remove('bg-indigo-50/50', 'border-indigo-200', 'border-dashed');
                      const node = e.dataTransfer.getData('application/my-app-node');
                      if (node) {
                        executeMoveNodeTag(node, category);
                      }
                    }
                  }}
                >
                        {nodesArray.map(({ node, status, list }) => {
                          let buttonClasses = '';
                          let dotClass = '';
                          const isInsight = node === insightNode;
                          
                          if (status === 'gray') {
                            dotClass = 'bg-gray-300';
                          } else if (status === 'red') {
                            dotClass = 'bg-rose-500';
                          } else if (status === 'yellow') {
                            dotClass = 'bg-amber-500';
                          } else {
                            dotClass = 'bg-emerald-500';
                          }

                          if (status === 'red') {
                            buttonClasses = 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 hover:border-rose-300';
                          } else if (status === 'yellow') {
                            buttonClasses = 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100 hover:border-amber-300';
                          } else if (status === 'green') {
                            buttonClasses = 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100 hover:border-emerald-300';
                          } else {
                            buttonClasses = 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300';
                          }
                          
                          if (isInsight) {
                            // 仅添加一点呼吸动画或外发光作为特殊强调，不改变描边深度，避免被当成 bug
                            buttonClasses += ' ring-2 ring-rose-400/30 ring-offset-1';
                          }

                          if (isGlobalEditing) {
                            return (
                              <EditableTag
                                key={node}
                                node={node}
                                buttonClasses={buttonClasses}
                                dotClass={dotClass}
                                onRename={(newVal) => executeRenameNodeTag(node, newVal)}
                                onDelete={() => executeDeleteNodeTag(node)}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  e.dataTransfer.setData('application/my-app-node', node);
                                  e.dataTransfer.setData('application/vlearn-source-category', category);
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragOver={(e) => {
                                  if (e.dataTransfer.types.includes('application/my-app-node')) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }
                                }}
                                onDrop={(e) => {
                                  if (e.dataTransfer.types.includes('application/my-app-node')) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const sourceNode = e.dataTransfer.getData('application/my-app-node');
                                    const sourceCategory = e.dataTransfer.getData('application/vlearn-source-category');
                                    if (sourceNode && sourceCategory) {
                                      handleDropTag(sourceNode, sourceCategory, node, category);
                                    }
                                  }
                                }}
                              />
                            );
                          }

                          return (
                            <button
                              key={node}
                              type="button"
                              onClick={() => navigate(\`/questions/node?subject=\${encodeURIComponent(subject)}&category=\${encodeURIComponent(category)}&node=\${encodeURIComponent(node)}\`, { state: { subject, category, node, archiveView } })}
                              className={\`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm text-[13px] font-medium tracking-wide transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-95 cursor-pointer \${buttonClasses}\`}
                              title="点击查看错题"
                            >
                              <span className={\`w-1.5 h-1.5 rounded-full shrink-0 \${dotClass}\`}></span>
                              {node}
                            </button>
                          );
                        })}
                        
                        {isGlobalEditing && (
                          <AddTagBox onAdd={(tag) => executeAddNodeTag(category, tag)} />
                        )}
                      </div>
              </div>`;

const newStr = `<div className="pt-4 pb-2">
                <div className="flex flex-col gap-6">
                  {[
                    { id: 'red', nodes: nodesArray.filter(n => n.status === 'red') },
                    { id: 'yellow', nodes: nodesArray.filter(n => n.status === 'yellow') },
                    { id: 'green', nodes: nodesArray.filter(n => n.status === 'green' || n.status === 'gray') }
                  ].map(group => group.nodes.length > 0 || (isGlobalEditing && group.id === 'green') ? (
                    <div key={group.id} className="space-y-3">
                      <ReactSortable
                        list={group.nodes}
                        setList={(newState) => {
                          if (JSON.stringify(newState.map(n => n.node)) === JSON.stringify(group.nodes.map(n => n.node))) return;
                          
                          setSortConfig(prev => {
                            const subConfig = prev[subject] || { categories: [], tags: {} };
                            const newOrder = [
                              ...(group.id === 'red' ? newState : nodesArray.filter(n => n.status === 'red')),
                              ...(group.id === 'yellow' ? newState : nodesArray.filter(n => n.status === 'yellow')),
                              ...(group.id === 'green' ? newState : nodesArray.filter(n => n.status === 'green' || n.status === 'gray')),
                            ].map(n => n.node);
                            
                            return {
                              ...prev,
                              [subject]: {
                                ...subConfig,
                                tags: { ...(subConfig.tags || {}), [category]: newOrder }
                              }
                            };
                          });
                        }}
                        group={{ name: \`\${category}-\${group.id}\`, pull: false, put: false }}
                        animation={150}
                        disabled={!isGlobalEditing}
                        className="flex flex-wrap gap-x-4 gap-y-5 p-2 -m-2 rounded-xl transition-all duration-200 min-h-[40px] border-2 border-transparent"
                      >
                        {group.nodes.map(({ node, status, list }) => {
                          let buttonClasses = '';
                          let dotClass = '';
                          const isInsight = node === insightNode;
                          
                          if (status === 'gray') {
                            dotClass = 'bg-gray-300';
                          } else if (status === 'red') {
                            dotClass = 'bg-rose-500';
                          } else if (status === 'yellow') {
                            dotClass = 'bg-amber-500';
                          } else {
                            dotClass = 'bg-emerald-500';
                          }

                          if (status === 'red') {
                            buttonClasses = 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 hover:border-rose-300';
                          } else if (status === 'yellow') {
                            buttonClasses = 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100 hover:border-amber-300';
                          } else if (status === 'green') {
                            buttonClasses = 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100 hover:border-emerald-300';
                          } else {
                            buttonClasses = 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300';
                          }
                          
                          if (isInsight) {
                            buttonClasses += ' ring-2 ring-rose-400/30 ring-offset-1';
                          }

                          if (isGlobalEditing) {
                            return (
                              <EditableTag
                                key={node}
                                node={node}
                                buttonClasses={buttonClasses}
                                dotClass={dotClass}
                                onRename={(newVal) => executeRenameNodeTag(node, newVal)}
                                onDelete={() => executeDeleteNodeTag(node)}
                                onDragStart={() => {}}
                                onDragOver={() => {}}
                                onDrop={() => {}}
                              />
                            );
                          }

                          return (
                            <button
                              key={node}
                              type="button"
                              onClick={() => navigate(\`/questions/node?subject=\${encodeURIComponent(subject)}&category=\${encodeURIComponent(category)}&node=\${encodeURIComponent(node)}\`, { state: { subject, category, node, archiveView } })}
                              className={\`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm text-[13px] font-medium tracking-wide transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-95 cursor-pointer \${buttonClasses}\`}
                              title="点击查看错题"
                            >
                              <span className={\`w-1.5 h-1.5 rounded-full shrink-0 \${dotClass}\`}></span>
                              {node}
                            </button>
                          );
                        })}
                      </ReactSortable>
                      {isGlobalEditing && group.id === 'green' && (
                        <div className="pt-2">
                          <AddTagBox onAdd={(tag) => executeAddNodeTag(category, tag)} />
                        </div>
                      )}
                    </div>
                  ) : null)}
                </div>
              </div>`;

if(content.includes(oldStr)) {
  content = content.replace(oldStr, newStr);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Successfully replaced the block.');
} else {
  console.error('Could not find the exact old string. Please double check.');
}
