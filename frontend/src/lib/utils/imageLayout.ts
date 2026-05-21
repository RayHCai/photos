interface LayoutItem {
    id: string;
    width: number | null;
    height: number | null;
}

export interface LayoutRow {
    items: Array<LayoutItem & { scaledWidth: number; scaledHeight: number }>;
    height: number;
}

export function computeJustifiedLayout(
    items: LayoutItem[],
    containerWidth: number,
    targetRowHeight: number = 220,
    gap: number = 2
): LayoutRow[] {
    if (containerWidth <= 0 || items.length === 0) return [];

    const rows: LayoutRow[] = [];
    let currentRow: LayoutItem[] = [];
    let currentRowAspectSum = 0;

    for (const item of items) {
        const w = item.width || 400;
        const h = item.height || 300;
        const aspect = w / h;
        currentRow.push(item);
        currentRowAspectSum += aspect;

        const totalGap = (currentRow.length - 1) * gap;
        const rowHeight = (containerWidth - totalGap) / currentRowAspectSum;

        if (rowHeight <= targetRowHeight) {
            rows.push({
                height: rowHeight,
                items: currentRow.map((ri) => {
                    const riAspect = (ri.width || 400) / (ri.height || 300);
                    return {
                        ...ri,
                        scaledWidth: riAspect * rowHeight,
                        scaledHeight: rowHeight,
                    };
                }),
            });
            currentRow = [];
            currentRowAspectSum = 0;
        }
    }

    if (currentRow.length > 0) {
        rows.push({
            height: targetRowHeight,
            items: currentRow.map((ri) => {
                const riAspect = (ri.width || 400) / (ri.height || 300);
                return {
                    ...ri,
                    scaledWidth: riAspect * targetRowHeight,
                    scaledHeight: targetRowHeight,
                };
            }),
        });
    }

    return rows;
}
