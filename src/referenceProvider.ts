import * as vscode from 'vscode';
import { DatFileParser } from './parser/datFileParser';
import { SectionInfo } from './types/datFileTypes';
import { VisualBlocksParser } from './parser/visualBlocksParser';

export class DatReferenceProvider implements vscode.ReferenceProvider {
  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Location[]> {
    const wordRange = document.getWordRangeAtPosition(position);
    const word = wordRange ? document.getText(wordRange) : '';

    if (!word) {
      return [];
    }

    const references: vscode.Location[] = [];
    const parser = new DatFileParser(document.getText());
    const currentSection = parser.getSectionAtPosition(position.line);
    const lineText = document.lineAt(position).text;

    // Include definition if requested
    if (context.includeDeclaration) {
      const definition = this.findDefinition(document, word, lineText, currentSection, parser);
      if (definition) {
        references.push(definition);
      }
    }

    // Find references based on context
    if (this.isEntityId(lineText)) {
      references.push(...this.findEntityReferences(document, word, parser));
    } else if (this.isEventName(lineText)) {
      references.push(...this.findEventReferences(document, word, parser));
    } else if (this.isVariableName(lineText)) {
      references.push(...this.findVariableReferences(document, word, parser));
    } else if (this.isSectionName(word)) {
      references.push(...this.findSectionReferences(document, word));
    }

    return references;
  }

  private isEntityId(lineText: string): boolean {
    return lineText.includes('ID=') || lineText.match(/(?:enable|disable|wake)\s*:\s*\w+/) !== null;
  }

  private isEventName(lineText: string): boolean {
    return (
      lineText.includes('::') ||
      lineText.includes('))') ||
      lineText.match(/when\s*\([^)]*\)\s*\[\w+\]/) !== null
    );
  }

  private isVariableName(lineText: string): boolean {
    return (
      lineText.match(/(?:int|string|float|bool|timer|arrow)\s+\w+\s*=/) !== null ||
      lineText.includes('variable:') ||
      lineText.match(/^\s*\w+\s*=/) !== null
    );
  }

  private isSectionName(word: string): boolean {
    const sections = [
      'comments',
      'info',
      'tiles',
      'height',
      'resources',
      'objectives',
      'buildings',
      'vehicles',
      'creatures',
      'miners',
      'blocks',
      'script',
      'briefing',
      'briefingsuccess',
      'briefingfailure',
      'landslidefrequency',
      'lavaspread',
    ];
    return sections.includes(word.toLowerCase());
  }

  private findDefinition(
    document: vscode.TextDocument,
    _word: string,
    lineText: string,
    currentSection: SectionInfo | undefined,
    _parser: DatFileParser
  ): vscode.Location | undefined {
    // Find entity definition
    if (lineText.includes('ID=') && currentSection) {
      return new vscode.Location(
        document.uri,
        new vscode.Position(currentSection.startLine + 1, 0)
      );
    }

    // Find event definition
    if (lineText.includes('::') && !lineText.includes('((') && currentSection) {
      return new vscode.Location(
        document.uri,
        new vscode.Position(currentSection.startLine + 1, 0)
      );
    }

    // Find variable definition
    if (lineText.match(/(?:int|string|float|bool)\s+\w+\s*=/) && currentSection) {
      return new vscode.Location(
        document.uri,
        new vscode.Position(currentSection.startLine + 1, 0)
      );
    }

    return undefined;
  }

  private findEntityReferences(
    document: vscode.TextDocument,
    entityId: string,
    parser: DatFileParser
  ): vscode.Location[] {
    const references: vscode.Location[] = [];

    // Search in script section for enable/disable/wake commands
    const scriptSection = parser.getSection('script');
    if (scriptSection) {
      const lines = scriptSection.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const regex = new RegExp(`(?:enable|disable|wake)\\s*:\\s*${entityId}\\b`);
        if (regex.test(lines[i])) {
          const line = scriptSection.startLine + i + 1;
          const col = lines[i].indexOf(entityId);
          references.push(
            new vscode.Location(
              document.uri,
              new vscode.Range(
                new vscode.Position(line, col),
                new vscode.Position(line, col + entityId.length)
              )
            )
          );
        }
      }
    }

    return references;
  }

  private findEventReferences(
    document: vscode.TextDocument,
    eventName: string,
    parser: DatFileParser
  ): vscode.Location[] {
    const references: vscode.Location[] = [];
    const scriptSection = parser.getSection('script');

    if (!scriptSection) {
      return references;
    }

    const lines = scriptSection.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // Find event calls (EventName::)
      const callRegex = new RegExp(`${eventName}\\s*::`);
      if (callRegex.test(lines[i]) && !lines[i].match(new RegExp(`^\\s*${eventName}\\s*::`))) {
        const line = scriptSection.startLine + i + 1;
        const col = lines[i].indexOf(eventName);
        references.push(
          new vscode.Location(
            document.uri,
            new vscode.Range(
              new vscode.Position(line, col),
              new vscode.Position(line, col + eventName.length)
            )
          )
        );
      }

      // Find event references in when() conditions
      const whenRegex = new RegExp(`when\\s*\\([^)]*\\)\\s*\\[${eventName}\\]`);
      if (whenRegex.test(lines[i])) {
        const line = scriptSection.startLine + i + 1;
        const col = lines[i].lastIndexOf(eventName);
        references.push(
          new vscode.Location(
            document.uri,
            new vscode.Range(
              new vscode.Position(line, col),
              new vscode.Position(line, col + eventName.length)
            )
          )
        );
      }

      // Find in timer declarations
      const timerRegex = new RegExp(`timer\\s+\\w+\\s*=.*,\\s*${eventName}\\s*$`);
      if (timerRegex.test(lines[i])) {
        const line = scriptSection.startLine + i + 1;
        const col = lines[i].lastIndexOf(eventName);
        references.push(
          new vscode.Location(
            document.uri,
            new vscode.Range(
              new vscode.Position(line, col),
              new vscode.Position(line, col + eventName.length)
            )
          )
        );
      }

      // Find old-style event calls
      const oldCallRegex = new RegExp(`\\)\\)\\s*${eventName}\\s*;`);
      if (oldCallRegex.test(lines[i])) {
        const line = scriptSection.startLine + i + 1;
        const col = lines[i].indexOf(eventName);
        references.push(
          new vscode.Location(
            document.uri,
            new vscode.Range(
              new vscode.Position(line, col),
              new vscode.Position(line, col + eventName.length)
            )
          )
        );
      }

      // Find call: command references
      const callCommandRegex = new RegExp(`call\\s*:\\s*${eventName}\\b`);
      if (callCommandRegex.test(lines[i])) {
        const line = scriptSection.startLine + i + 1;
        const col = lines[i].lastIndexOf(eventName);
        references.push(
          new vscode.Location(
            document.uri,
            new vscode.Range(
              new vscode.Position(line, col),
              new vscode.Position(line, col + eventName.length)
            )
          )
        );
      }
    }

    // Also check in visual blocks section
    const blocksSection = parser.getSection('blocks');
    if (blocksSection) {
      const blocksParser = new VisualBlocksParser(blocksSection.content, blocksSection.startLine);
      const { blocks } = blocksParser.parse();

      for (const block of blocks) {
        // Check EventCallEvent blocks
        if (block.name === 'EventCallEvent' && block.parameters.function === eventName) {
          references.push(
            new vscode.Location(
              document.uri,
              new vscode.Range(
                new vscode.Position((block.line || blocksSection.startLine) - 1, 0),
                new vscode.Position((block.line || blocksSection.startLine) - 1, 100)
              )
            )
          );
        }
      }
    }

    return references;
  }

  private findVariableReferences(
    document: vscode.TextDocument,
    varName: string,
    parser: DatFileParser
  ): vscode.Location[] {
    const references: vscode.Location[] = [];

    // Search in script section
    const scriptSection = parser.getSection('script');
    if (scriptSection) {
      const lines = scriptSection.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // Find variable usage (simple word boundary check)
        const regex = new RegExp(`\\b${varName}\\b`);
        if (regex.test(lines[i])) {
          const line = scriptSection.startLine + i + 1;
          let col = lines[i].indexOf(varName);
          while (col !== -1) {
            references.push(
              new vscode.Location(
                document.uri,
                new vscode.Range(
                  new vscode.Position(line, col),
                  new vscode.Position(line, col + varName.length)
                )
              )
            );
            col = lines[i].indexOf(varName, col + 1);
          }
        }
      }
    }

    // Search in objectives section for variable references
    const objectivesSection = parser.getSection('objectives');
    if (objectivesSection) {
      const lines = objectivesSection.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`variable:${varName}`)) {
          const line = objectivesSection.startLine + i + 1;
          const col = lines[i].indexOf(varName);
          references.push(
            new vscode.Location(
              document.uri,
              new vscode.Range(
                new vscode.Position(line, col),
                new vscode.Position(line, col + varName.length)
              )
            )
          );
        }
      }
    }

    return references;
  }

  private findSectionReferences(
    document: vscode.TextDocument,
    sectionName: string
  ): vscode.Location[] {
    const references: vscode.Location[] = [];
    const lines = document.getText().split('\n');

    for (let i = 0; i < lines.length; i++) {
      // Find section references in comments or documentation
      const regex = new RegExp(`\\b${sectionName}\\b`, 'gi');
      let match;
      while ((match = regex.exec(lines[i])) !== null) {
        references.push(
          new vscode.Location(
            document.uri,
            new vscode.Range(
              new vscode.Position(i, match.index),
              new vscode.Position(i, match.index + sectionName.length)
            )
          )
        );
      }
    }

    return references;
  }
}
