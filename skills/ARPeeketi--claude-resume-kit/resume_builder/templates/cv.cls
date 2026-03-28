%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Medium Length Professional CV - CV CLASS FILE
%
% This template has been downloaded from:
% http://www.LaTeXTemplates.com
%
% This class file defines the structure and design of the template. 
%
% Original header:
% Copyright (C) 2010 by Trey Hunner
%
% Copying and distribution of this file, with or without modification,
% are permitted in any medium without royalty provided the copyright
% notice and this notice are preserved. This file is offered as-is,
% without any warranty.
%
% Created by Trey Hunner and modified by www.LaTeXTemplates.com
%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

\ProvidesClass{cv}[2018/09/25 v1.0 CV class]  

\LoadClass[11pt, a4paper]{article} % Font size and paper type  
\usepackage{lastpage}
\usepackage[parfill]{parskip} % Remove paragraph indentation
\usepackage{array} % Required for boldface (\bf and \bfseries) tabular columns
\usepackage{ifthen} % Required for ifthenelse statements
\usepackage{enumitem}
% \usepackage{fancyhdr}

% Page style with page numbers at true bottom right (page edge)
% \pagestyle{fancy}
% \fancyhf{} % Clear all header and footer fields
% \renewcommand{\headrulewidth}{0pt} % Remove header line
% \renewcommand{\footrulewidth}{0pt} % Remove footer line
% Extend footer to full page width to get true right alignment
% \fancyhfoffset[R]{0.75in} % Match right margin from geometry
% \rfoot{\thepage/\pageref{LastPage}} % Page number at bottom right as X/Y
% \fancyfoot[R]{\hfill \thepage/\pageref{LastPage}}


%----------------------------------------------------------------------------------------
%	HEADINGS COMMANDS: Commands for printing name and address
%----------------------------------------------------------------------------------------

\def \name#1{\def\@name{#1}} % Defines the \name command to set name
\def \@name {} % Sets \@name to empty by default

\def \addressSep {$|$} % Set default address separator to a diamond

% One, two or three address lines can be specified 
\let \@addressone \relax
\let \@addresstwo \relax
\let \@addressthree \relax
\let \@addressfour \relax

% \address command can be used to set the first, second, and third address (last 2 optional)
\def \address #1{
  \@ifundefined{@addresstwo}{
    \def \@addresstwo {#1}
  }{
  \@ifundefined{@addressthree}{
  \def \@addressthree {#1}
  }{
  \@ifundefined{@addressfour}{
  \def \@addressfour {#1}
  } {\def \@addressone {#1}
  }
     
  }
  }
}

% \printaddress is used to style an address line (given as input)
\def \printaddress #1{
  \begingroup
    \def \\ {\addressSep\ }
             {#1}
%    \centerline{#1}
  \endgroup
  \par
 % \addressskip
}

% \printname is used to print the name as a page header
\def \printname {
  \begingroup
  % \MakeUppercase
  {\namesize\bf \@name} \hfil
%    \hfil{\MakeUppercase{\namesize\bf \@name}}\hfil
    \nameskip\break
  \endgroup
}

%----------------------------------------------------------------------------------------
%	PRINT THE HEADING LINES
%----------------------------------------------------------------------------------------

\let\ori@document=\document
\renewcommand{\document}{
  \ori@document  % Begin document
  % \begin{center}
  \printname % Print the name specified with \name
  \@ifundefined{@addressone}{}{ % Print the first address if specified
    \printaddress{\@addressone}}
  \@ifundefined{@addresstwo}{}{ % Print the second address if specified
    \printaddress{\@addresstwo}}
     \@ifundefined{@addressthree}{}{ % Print the third address if specified
    \printaddress{\@addressthree}}
     \@ifundefined{@addressfour}{}{ % Print the third address if specified
    \printaddress{\@addressfour}}
    
    % \end{center}
}

%----------------------------------------------------------------------------------------
%	SECTION FORMATTING
%----------------------------------------------------------------------------------------

% Defines the rSection environment for the large sections within the CV
\newenvironment{rSection}[1]{ % 1 input argument - section name
   \sectionskip
   {\bf #1}
%   \MakeUppercase{\bf #1} % Section title
   \sectionlineskip
  \hrule % Horizontal line
  \begin{list}{}{ % List for each individual item in the section
    \setlength{\leftmargin}{0.50em} % Margin within the section
  }
  \item[]
}{
  \end{list}
}

\newenvironment{rSection2}[1]{ % 1 input argument - section name
  \sectionskip
  {\bf #1} % Section title
  \sectionlineskip
  \hrule % Horizontal line
  \medskip
  \begin{list}{$\bullet$}{\setlength{\leftmargin}{1.5em}}
   \itemsep -0.3em \vspace{-0.5em} % Compress items in list together for aesthetics
}{
  \end{list}
 \vspace{0.5em}
}

\newenvironment{rSection3}[1]{ % 1 input argument - section name
  \sectionskip
  {\bf #1} % Section title
  \sectionlineskip
  \hrule % Horizontal line
  \medskip
  \begin{enumerate}[]{\setlength{\leftmargin}{1.5em}}
   \itemsep -0.3em \vspace{-0.5em} % Compress items in list together for aesthetics
}{
  \end{enumerate}
 \vspace{0.5em}
}
%----------------------------------------------------------------------------------------
%	WORK EXPERIENCE FORMATTING
%----------------------------------------------------------------------------------------

\newenvironment{rSubsection}[4]{ % 4 input arguments - company name, year(s) employed, job title and location
 {\bf #1} \hfill {#2} % Bold company name and date on the right
 \ifthenelse{\equal{#3}{}}{}{ % If the third argument is not specified, don't print the location line
  \\
  {\em #3} % Italic location on its own line
  }
 \ifthenelse{\equal{#4}{}}{}{ % If the fourth argument is not specified, don't print the mentors line
  \\
  {\em #4} % Italic mentors on its own line
  }\smallskip
  \begin{list}{$\cdot$}{\leftmargin=1.5em} % \cdot used for bullets, no indentation
   \itemsep -0.2em \vspace{-0.2em} % Compress items in list together for aesthetics
  }{
  \end{list}
  \vspace{0.2 em} % Some space after the list of bullet points
}



%----------------------------------------------------------------------------------------
%	FORMAT C SKILLS COMMANDS
%----------------------------------------------------------------------------------------

% Skills group environment: \begin{skillgroup}{Group Name} ... \end{skillgroup}
% CV uses LOCKED 4-4-3-3-3 structure (17 body lines).
\newenvironment{skillgroup}[1]{%
  \textbf{#1}\par\nopagebreak%
  \vspace{-\parskip}%
  \begin{list}{--}{\leftmargin=0.8em \labelsep=0.3em \itemsep=0pt \topsep=0.1em \parsep=0pt \partopsep=0pt}%
}{%
  \end{list}%
  \vspace{-\parskip}\vspace{0.45em}%
}

% Single dash sub-item within a skillgroup. Content must fit 1 rendered line.
% Char limit: 91 - (0.25 x bold_char_count) at 11pt
\newcommand{\skilldash}[1]{\item #1}

%----------------------------------------------------------------------------------------
%	EXPERIENCE SUB-THEME COMMAND
%----------------------------------------------------------------------------------------

% Sub-theme underline header within rSubsection
\newcommand{\subtheme}[1]{\item[] \underline{#1}}

% The below commands define the whitespace after certain things in the document - they can be \smallskip, \medskip or \bigskip
\def\namesize{\huge} % Size of the name at the top of the document
\def\addressskip{\smallskip} % The space between the two address (or phone/email) lines
\def\sectionlineskip{\medskip} % The space above the horizontal line for each section 
\def\nameskip{\medskip} % The space after your name at the top
\def\sectionskip{\medskip} % The space after the heading section