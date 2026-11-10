import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableItem({ id, item, index, renderItem, itemTag: Tag, itemClassName, disabled }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
  const handle = <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled} className="cs-drag-handle" aria-label={'Reorder ' + (item.title || 'collection')} title="Drag to reorder. Use Space and arrow keys with a keyboard.">
    <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">{[5,10,15].flatMap(y=>[5,11].map(x=><circle key={x+'-'+y} cx={x} cy={y} r="1.5"/>))}</svg>
  </button>;
  return <Tag ref={setNodeRef} className={itemClassName} data-sortable-id={id} data-dragging={isDragging} style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 10 : undefined }}>
    {renderItem(item, index, handle)}
  </Tag>;
}

export default function CompactSearchSortable({ items, getId, onChange, renderItem, disabled, className, itemClassName = '', listTag: List = 'div', itemTag = 'div', horizontal = false, ...props }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = items.map(getId);
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (disabled || !over || active.id === over.id) return;
    const from = ids.indexOf(active.id), to = ids.indexOf(over.id);
    if (from !== -1 && to !== -1) onChange(arrayMove(items, from, to));
  }}>
    <SortableContext items={ids} strategy={horizontal ? rectSortingStrategy : verticalListSortingStrategy}>
      <List className={className} {...props}>{items.map((item,index)=><SortableItem key={ids[index]} id={ids[index]} item={item} index={index} renderItem={renderItem} itemTag={itemTag} itemClassName={itemClassName} disabled={disabled}/>)}</List>
    </SortableContext>
  </DndContext>;
}
