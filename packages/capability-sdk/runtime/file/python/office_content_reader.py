"""Fixed, read-only UNO extraction. No model-authored code or source export."""
import json
import math
import re


class ContentLimit(Exception):
    pass


def supports(value, service):
    return hasattr(value, 'supportsService') and value.supportsService(service)


def prop(value, name, default=None):
    try:
        return getattr(value, name)
    except Exception:
        return default


def items(value):
    if hasattr(value, 'createEnumeration'):
        iterator = value.createEnumeration()
        while iterator.hasMoreElements():
            yield iterator.nextElement()
    elif hasattr(value, 'getCount'):
        for index in range(value.getCount()):
            yield value.getByIndex(index)


class Reader:
    def __init__(self, selection, progress):
        self.selection = selection
        self.progress = progress
        self.blocks = []
        self.warnings = []
        self.characters = 0
        self.truncated = False
        self.scope = {}
        self.heading_styles = {}

    def heading_level(self, paragraph):
        return int(prop(paragraph, 'OutlineLevel', 0)) or self.heading_styles.get(str(prop(paragraph, 'ParaStyleName', '')), 0)

    def warn(self, message):
        if message not in self.warnings and len(self.warnings) < 100:
            self.warnings.append(message)

    def add(self, kind, source, **values):
        block = dict(type=kind, source=source, **values)
        size = len(json.dumps(block, ensure_ascii=False, allow_nan=False))
        if len(self.blocks) >= 100000 or self.characters + size > 4000000:
            self.truncated = True
            self.warn('Extraction limit reached. Narrow the selection by section, contentPages, or sheet/range; character offsets only paginate the extracted portion.')
            raise ContentLimit()
        self.characters += size
        self.blocks.append(block)
        if len(self.blocks) % 100 == 0:
            self.progress('read-content', 'Reading document objects', len(self.blocks), None)

    def optional(self, label, operation):
        try:
            operation()
        except ContentLimit:
            raise
        except Exception as error:
            self.warn(f'{label} could not be fully extracted: {error}')

    def text(self, value, source, section=None):
        elements = list(items(value))
        start, end = 0, len(elements)
        if section:
            headings = [(i, str(prop(e, 'String', '')).strip(), self.heading_level(e))
                        for i, e in enumerate(elements) if self.heading_level(e) > 0]
            matches = [(i, level) for i, title, level in headings if title == section]
            if len(matches) != 1:
                raise ValueError('Heading is ambiguous' if matches else 'Heading not found. Available headings: ' + ' | '.join(title for _, title, _ in headings))
            start, level = matches[0]
            end = next((i for i, _, other in headings if i > start and other <= level), len(elements))
        for index in range(start, end):
            element = elements[index]
            location = dict(source, element=index + 1)
            if supports(element, 'com.sun.star.text.TextTable'):
                self.table(element, dict(location, table=str(prop(element, 'Name', ''))))
            else:
                text = str(prop(element, 'String', ''))
                if text:
                    self.add('paragraph', location, text=text,
                             headingLevel=self.heading_level(element), style=str(prop(element, 'ParaStyleName', '')))

    def table(self, table, source):
        if hasattr(table, 'getCellNames'):
            names = list(table.getCellNames())
            self.add('table', source, cellNames=names)
            for name in names:
                self.text(table.getCellByName(name), dict(source, cell=name))
        else:
            rows, columns = table.getRows().getCount(), table.getColumns().getCount()
            self.add('table', source, rows=rows, columns=columns)
            for row in range(rows):
                for column in range(columns):
                    cell = table.getCellByPosition(column, row)
                    self.add('cell', dict(source, row=row + 1, column=column + 1),
                             text=cell.getString(), rowSpan=int(prop(cell, 'RowSpan', 1)),
                             columnSpan=int(prop(cell, 'ColumnSpan', 1)),
                             merged=bool(prop(cell, 'IsMerged', False)))

    def chart(self, chart, source):
        data = chart.getData()
        values = [[number if not isinstance(number, float) or math.isfinite(number) else None
                   for number in row] for row in data.getData()]
        self.add('chart', source, rows=list(data.getRowDescriptions()),
                 columns=list(data.getColumnDescriptions()), values=values)

    def shapes(self, shapes, source):
        for index, shape in enumerate(items(shapes)):
            location = dict(source, shapePath=list(source.get('shapePath', [])) + [index + 1])
            kind = shape.getShapeType()
            bounds = None
            try:
                position, size = shape.getPosition(), shape.getSize()
                bounds = dict(x=position.X, y=position.Y, width=size.Width, height=size.Height, unit='1/100mm')
            except Exception:
                self.warn('Some anchored objects do not expose absolute bounds; use their document region and visual reading.')
            self.add('shape', location, shapeType=kind, name=str(prop(shape, 'Name', '')),
                     title=str(prop(shape, 'Title', '')), description=str(prop(shape, 'Description', '')),
                     bounds=bounds)
            if supports(shape, 'com.sun.star.drawing.GroupShape'):
                self.shapes(shape, location)
                continue
            if supports(shape, 'com.sun.star.drawing.TableShape'):
                self.optional(f'Table {location}', lambda: self.table(shape.Model, location))
            elif hasattr(shape, 'getString') and shape.getString():
                self.add('text', location, text=shape.getString())
            if supports(shape, 'com.sun.star.drawing.GraphicObjectShape') or supports(shape, 'com.sun.star.text.TextGraphicObject'):
                self.warn('Image pixels were not OCRed. Use visual reading for image text and diagrams.')
            if supports(shape, 'com.sun.star.drawing.OLE2Shape'):
                model = prop(shape, 'Model')
                if model and (supports(model, 'com.sun.star.chart.ChartDocument') or supports(model, 'com.sun.star.chart2.ChartDocument')):
                    self.optional(f'Chart {location}', lambda: self.chart(model, location))
                else:
                    self.warn('An embedded object was not expanded; inspect its visual representation or source object.')

    def writer(self, document):
        paragraph_styles = document.getStyleFamilies().getByName('ParagraphStyles')
        # Imported documents can use Writer's built-in heading styles without
        # assigning an explicit outline level or chapter-numbering rule.
        for level in range(1, 11):
            name = f'Heading {level}'
            if paragraph_styles.hasByName(name) and not paragraph_styles.getByName(name).isUserDefined():
                self.heading_styles[name] = level
        rules = document.getChapterNumberingRules()
        for index in range(rules.getCount()):
            for setting in rules.getByIndex(index):
                if setting.Name == 'HeadingStyleName' and setting.Value:
                    self.heading_styles[str(setting.Value)] = index + 1
        section = self.selection.get('section')
        self.scope = dict(kind='word', section=section, includesSupplementaryRegions=not bool(section))
        self.text(document.getText(), dict(region='body'), section)
        if section:
            self.warn('Section selection includes its body paragraphs and tables. Headers, notes and anchored objects are outside this selection.')
            return
        frames = document.getTextFrames()
        for name in frames.getElementNames():
            self.optional(f'Text frame {name}', lambda name=name: self.text(frames.getByName(name).getText(), dict(region='text-frame', name=name)))
        for label, collection in [('footnote', document.getFootnotes()), ('endnote', document.getEndnotes())]:
            for index, note in enumerate(items(collection)):
                self.optional(label, lambda note=note, index=index: self.text(note, dict(region=label, index=index + 1)))
        styles = document.getStyleFamilies().getByName('PageStyles')
        for name in styles.getElementNames():
            style = styles.getByName(name)
            if not style.isInUse():
                continue
            for region in ('Header', 'Footer'):
                if not prop(style, region + 'IsOn', False):
                    continue
                variants = [region + 'Text']
                if not prop(style, region + 'IsShared', True):
                    variants += [region + 'TextLeft', region + 'TextRight']
                if not prop(style, 'FirstIsShared', True):
                    variants += [region + 'TextFirst']
                for variant in variants:
                    content = prop(style, variant)
                    if content:
                        self.optional(variant, lambda content=content, variant=variant: self.text(content, dict(region=variant, pageStyle=name)))
        for field in items(document.getTextFields()):
            if supports(field, 'com.sun.star.text.textfield.Annotation'):
                self.add('comment', dict(region='comments'), text=str(prop(field, 'Content', '')), author=str(prop(field, 'Author', '')))
        self.optional('Drawing objects', lambda: self.shapes(document.getDrawPage(), dict(region='drawing')))

    def presentation(self, document):
        pages = document.getDrawPages()
        count = pages.getCount()
        selected = self.selection.get('contentPages') or list(range(1, count + 1))
        if any(not isinstance(page, int) or page < 1 or page > count for page in selected):
            raise ValueError(f'Requested slide exceeds slide count: {count}')
        self.scope = dict(kind='presentation', totalSlides=count, slides=selected)
        self.warn('Object order follows the document object tree; use bounds or visual reading to interpret complex layouts. Animation timelines and transition effects are not extracted.')
        for number in selected:
            page = pages.getByIndex(number - 1)
            self.add('slide', dict(slide=number), name=str(prop(page, 'Name', '')), hidden=not bool(prop(page, 'Visible', True)))
            self.shapes(page, dict(slide=number, region='slide'))
            self.optional(f'Notes for slide {number}', lambda: self.shapes(page.getNotesPage(), dict(slide=number, region='notes')))
            self.optional(f'Master for slide {number}', lambda: self.shapes(page.getMasterPage(), dict(slide=number, region='master')))

    def spreadsheet(self, document):
        # Opening may already evaluate formulas. Never label these values as
        # the original OOXML cache, and never explicitly recalculate or refresh.
        document.enableAutomaticCalculation(False)
        sheets = document.getSheets()
        all_names = list(sheets.getElementNames())
        selected = [self.selection['sheet']] if self.selection.get('sheet') else all_names
        if any(name not in all_names for name in selected):
            raise ValueError('Worksheet not found. Available worksheets: ' + ' | '.join(all_names))
        region = self.selection.get('range')
        if region and len(selected) != 1:
            raise ValueError('Specify sheet for a multi-sheet workbook.')
        if region and not re.fullmatch(r'\$?[A-Za-z]{1,3}\$?[1-9]\d*(?::\$?[A-Za-z]{1,3}\$?[1-9]\d*)?', region):
            raise ValueError('range must be an A1 cell or rectangle.')
        self.scope = dict(kind='spreadsheet', sheets=selected, availableSheets=all_names, range=region,
                          formulaResultOrigin='libreoffice-loaded', recalculationRequested=False)
        self.warn('Formula results reflect LibreOffice loading, not guaranteed original-file cached values. No explicit recalculation, macros or external-link refresh was requested.')
        visited = 0
        for name in selected:
            sheet = sheets.getByName(name)
            self.add('worksheet', dict(sheet=name), visible=bool(prop(sheet, 'IsVisible', True)))
            target = sheet.getCellRangeByName(region) if region else sheet
            if region:
                address = target.getRangeAddress()
                if (address.EndColumn-address.StartColumn+1)*(address.EndRow-address.StartRow+1) > 100000:
                    raise ValueError('Requested range exceeds 100000 cells.')
            # Values, dates, strings, annotations and formulas; ignore formatting-only cells.
            ranges = target.queryContentCells(1 | 2 | 4 | 8 | 16).getRangeAddresses()
            for address in ranges:
                for row in range(address.StartRow, address.EndRow + 1):
                    for column in range(address.StartColumn, address.EndColumn + 1):
                        visited += 1
                        if visited > 100000:
                            self.truncated = True
                            self.warn('Cell limit reached. Continue with a narrower sheet/range; this is not the complete workbook.')
                            raise ContentLimit()
                        cell = sheet.getCellByPosition(column, row)
                        kind = str(cell.getType().value)
                        if kind == 'EMPTY' and not cell.getAnnotation().getString():
                            continue
                        location = dict(sheet=name, cell=cell.getCellAddress().Column, row=row + 1, column=column + 1)
                        cursor = sheet.createCursorByRange(cell)
                        cursor.collapseToMergedArea()
                        merged = cursor.getRangeAddress()
                        location['cell'] = cell.AbsoluteName.split('.')[-1].replace('$', '')
                        formula = cell.getFormula() if kind == 'FORMULA' else None
                        result_type = prop(cell, 'FormulaResultType') if formula else None
                        result_kind = str(result_type.value) if hasattr(result_type, 'value') else str(result_type)
                        number = cell.getValue()
                        error_code = cell.getError()
                        self.add('cell', location, cellType=kind, formula=formula,
                                 display=cell.getString(), numericValue=number if not error_code and math.isfinite(number) and (kind == 'VALUE' or result_kind == 'VALUE') else None,
                                 formulaResultType=result_kind if formula else None, errorCode=error_code,
                                 comment=cell.getAnnotation().getString(),
                                 mergedRange=dict(startRow=merged.StartRow+1, endRow=merged.EndRow+1,
                                                  startColumn=merged.StartColumn+1, endColumn=merged.EndColumn+1)
                                 if merged.StartRow != merged.EndRow or merged.StartColumn != merged.EndColumn else None)
            self.optional(f'Drawing objects on {name}', lambda: self.shapes(sheet.getDrawPage(), dict(sheet=name, region='drawing')))


def extract_document(document, kind, selection, progress):
    if (selection.get('sheet') or selection.get('range')) and kind != 'spreadsheet':
        raise ValueError('sheet/range are supported only for spreadsheets.')
    if selection.get('section') and kind != 'word':
        raise ValueError('section is supported only for Word documents.')
    if selection.get('contentPages') and kind != 'presentation':
        raise ValueError('contentPages selects slides for Office files. Use section for Word and sheet/range for Excel.')
    reader = Reader(selection, progress)
    reader.warn('Content represents the LibreOffice-imported document model. Unsupported Office features and image pixels may need visual inspection; this is not a lossless source-package dump.')
    try:
        getattr(reader, dict(word='writer', presentation='presentation', spreadsheet='spreadsheet')[kind])(document)
    except ContentLimit:
        pass
    return dict(schemaVersion=1, parser='libreoffice-uno', scope=reader.scope,
                truncated=reader.truncated, warnings=reader.warnings, blocks=reader.blocks)
