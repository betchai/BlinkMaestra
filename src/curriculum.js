// Curriculum competency reference library.
// Seeded with representative MATATAG/K-12 learning competencies. Administrators can
// extend or replace entries via /api/admin/competencies as official CG data is loaded.
// Each entry: { id, code, gradeLevel, subject, description, quarterTerm, source, version }

export const COMPETENCY_SOURCE = 'DepEd K-12/MATATAG Curriculum Guide (curated reference subset — import the full official CG via Admin for complete coverage)';

export function seedCompetencies() {
  return [
    // Grade 3
    { id: 'g3-sci-1', code: 'S3LT-Ii-j-13', gradeLevel: 'Grade 3', subject: 'Science', description: 'Describe the parts of plants and their functions', quarterTerm: 'Q1' },
    { id: 'g3-mat-1', code: 'M3NS-Ib-15.2', gradeLevel: 'Grade 3', subject: 'Mathematics', description: 'Adds 3- to 4-digit numbers up to 10,000 with regrouping', quarterTerm: 'Q1' },
    { id: 'g3-eng-1', code: 'EN3RC-Ia-7.1', gradeLevel: 'Grade 3', subject: 'English', description: 'Reads grade-level text with understanding and answers questions about it', quarterTerm: 'Q1' },
    // Grade 4
    { id: 'g4-sci-1', code: 'S4MT-Ia-b-1', gradeLevel: 'Grade 4', subject: 'Science', description: 'Classify materials based on the ability to absorb water, float, sink, undergo decay', quarterTerm: 'Q1' },
    { id: 'g4-mat-1', code: 'M4NS-Ii-96', gradeLevel: 'Grade 4', subject: 'Mathematics', description: 'Find the area of irregular figures made up of squares and rectangles', quarterTerm: 'Q4' },
    { id: 'g4-fil-1', code: 'F4PN-Ia-b-2', gradeLevel: 'Grade 4', subject: 'Filipino', description: 'Naibibigay ang paksa ng napakinggang teksto', quarterTerm: 'Q1' },
    // Grade 5
    { id: 'g5-sci-1', code: 'S5FE-IIIc-3', gradeLevel: 'Grade 5', subject: 'Science', description: 'Describe the changes in properties of materials when exposed to certain conditions', quarterTerm: 'Q3' },
    { id: 'g5-mat-1', code: 'M5NS-Ia-87.1', gradeLevel: 'Grade 5', subject: 'Mathematics', description: 'Visualizes addition and subtraction of fractions', quarterTerm: 'Q1' },
    { id: 'g5-eng-1', code: 'EN5RC-Ig-2.23', gradeLevel: 'Grade 5', subject: 'English', description: 'Identify the main idea and supporting details of a text', quarterTerm: 'Q1' },
    // Grade 6
    { id: 'g6-sci-1', code: 'S6ES-IVa-8', gradeLevel: 'Grade 6', subject: 'Science', description: 'Describe the water cycle and its importance to living things', quarterTerm: 'Q4' },
    { id: 'g6-sci-2', code: 'S6MT-Ia-c-1', gradeLevel: 'Grade 6', subject: 'Science', description: 'Describe mixtures and distinguish them from compounds based on set of properties', quarterTerm: 'Q1' },
    { id: 'g6-mat-1', code: 'M6NS-Ib-92', gradeLevel: 'Grade 6', subject: 'Mathematics', description: 'Multiplies decimals and mixed decimals through thousandths without and with regrouping', quarterTerm: 'Q1' },
    { id: 'g6-eng-1', code: 'EN6RC-Ia-2.23.1', gradeLevel: 'Grade 6', subject: 'English', description: 'Analyze narrative elements including plot, character, and setting', quarterTerm: 'Q1' },
    { id: 'g6-fil-1', code: 'F6PU-Ia-c-9', gradeLevel: 'Grade 6', subject: 'Filipino', description: 'Nagagamit nang wasto ang pangngalan sa pagsasalaysay', quarterTerm: 'Q1' },
    // Grade 7
    { id: 'g7-sci-1', code: 'S7MT-Ia-1', gradeLevel: 'Grade 7', subject: 'Science', description: 'Describe the components of a scientific investigation', quarterTerm: 'Q1' },
    { id: 'g7-mat-1', code: 'M7NS-Ia-1', gradeLevel: 'Grade 7', subject: 'Mathematics', description: 'Describes well-defined sets, subsets, universal sets, and the null set', quarterTerm: 'Q1' },
    { id: 'g7-eng-1', code: 'EN7LT-I-a-1', gradeLevel: 'Grade 7', subject: 'English', description: 'Discover literature as a means of connecting to a significant past', quarterTerm: 'Q1' },
    // Grade 8
    { id: 'g8-sci-1', code: 'S8ES-Ia-1', gradeLevel: 'Grade 8', subject: 'Science', description: 'Describe the distribution of active volcanoes, earthquake epicenters, and mountain belts', quarterTerm: 'Q1' },
    { id: 'g8-mat-1', code: 'M8AL-Ia-1', gradeLevel: 'Grade 8', subject: 'Mathematics', description: 'Factors completely different types of polynomials', quarterTerm: 'Q1' },
    // Grade 9
    { id: 'g9-sci-1', code: 'S9LT-Ia-25', gradeLevel: 'Grade 9', subject: 'Science', description: 'Explain how the respiratory and circulatory systems work together', quarterTerm: 'Q1' },
    { id: 'g9-mat-1', code: 'M9AL-Ia-1', gradeLevel: 'Grade 9', subject: 'Mathematics', description: 'Illustrates quadratic equations and their solutions', quarterTerm: 'Q1' },
    // Grade 10
    { id: 'g10-sci-1', code: 'S10ES-Ia-1', gradeLevel: 'Grade 10', subject: 'Science', description: 'Describe the distribution of tectonic plates and their role in geologic events', quarterTerm: 'Q1' },
    { id: 'g10-mat-1', code: 'M10AL-Ia-1', gradeLevel: 'Grade 10', subject: 'Mathematics', description: 'Generates patterns and describes sequences', quarterTerm: 'Q1' },
    // Grade 6 additions
    { id: 'g6-sci-3', code: 'S6ES-IVb-2', gradeLevel: 'Grade 6', subject: 'Science', description: 'Infer why the Philippines is prone to typhoons', quarterTerm: 'Q4' },
    { id: 'g6-sci-4', code: 'S6MT-Ih-5', gradeLevel: 'Grade 6', subject: 'Science', description: 'Describe techniques in separating mixtures such as decantation, evaporation, and filtering', quarterTerm: 'Q1' },
    { id: 'g6-sci-5', code: 'S6FE-Ia-c-1', gradeLevel: 'Grade 6', subject: 'Science', description: 'Report on the importance of friction in daily activities', quarterTerm: 'Q1' },
    { id: 'g6-eng-2', code: 'EN6WC-Ia-2.2.1', gradeLevel: 'Grade 6', subject: 'English', description: 'Compose clear and coherent sentences using appropriate grammatical structures', quarterTerm: 'Q1' },
    // Grade 5 additions
    { id: 'g5-sci-2', code: 'S5FE-Ib-2', gradeLevel: 'Grade 5', subject: 'Science', description: 'Describe the reproductive parts of plants and their functions', quarterTerm: 'Q1' },
    { id: 'g5-sci-3', code: 'S5MT-Ie-f-4', gradeLevel: 'Grade 5', subject: 'Science', description: 'Design a product out of local, recyclable solid or liquid materials', quarterTerm: 'Q1' },
    { id: 'g5-ap-1', code: 'AP5PKP-Ia-1', gradeLevel: 'Grade 5', subject: 'Araling Panlipunan', description: 'Naipapaliwanag ang konsepto ng Asya sa heograpiya', quarterTerm: 'Q1' },
    // Grade 4 additions
    { id: 'g4-sci-2', code: 'S4ES-Ia-b-2', gradeLevel: 'Grade 4', subject: 'Science', description: 'Describe the effects of the sun on land and water', quarterTerm: 'Q1' },
    { id: 'g4-eng-1', code: 'EN4LC-Ia-2.1', gradeLevel: 'Grade 4', subject: 'English', description: 'Note details in selections listened to', quarterTerm: 'Q1' },
    { id: 'g4-ap-1', code: 'AP4PKP-Ia-b-1', gradeLevel: 'Grade 4', subject: 'Araling Panlipunan', description: 'Nasasabi ang kahalagahan ng lokasyon ng Pilipinas', quarterTerm: 'Q1' },
    // Grade 7 additions
    { id: 'g7-sci-2', code: 'S7ES-Ia-1', gradeLevel: 'Grade 7', subject: 'Science', description: 'Describe the scientific method and its role in investigating phenomena', quarterTerm: 'Q1' },
    { id: 'g7-fil-1', code: 'F7PU-Ia-1', gradeLevel: 'Grade 7', subject: 'Filipino', description: 'Naipapahayag ang sariling opinyon tungkol sa paksa ng napakinggang teksto', quarterTerm: 'Q1' },
    { id: 'g7-ap-1', code: 'AP7HS-Ia-1', gradeLevel: 'Grade 7', subject: 'Araling Panlipunan', description: 'Nasusuri ang konsepto ng Asya batay sa katangiang pisikal', quarterTerm: 'Q1' },
    // Grade 8 additions
    { id: 'g8-sci-2', code: 'S8MT-Ia-b-4', gradeLevel: 'Grade 8', subject: 'Science', description: 'Determine the properties of elements based on their position in the periodic table', quarterTerm: 'Q1' },
    { id: 'g8-eng-1', code: 'EN8LT-Ia-8', gradeLevel: 'Grade 8', subject: 'English', description: 'Identify notable literary genres contributed by Southeast Asian literature', quarterTerm: 'Q1' },
    // Grade 9 additions
    { id: 'g9-sci-2', code: 'S9LT-Ib-c-27', gradeLevel: 'Grade 9', subject: 'Science', description: 'Explain how the nervous system coordinates body functions', quarterTerm: 'Q1' },
    { id: 'g9-eng-1', code: 'EN9RC-Ia-16', gradeLevel: 'Grade 9', subject: 'English', description: 'Share prior knowledge about a topic and relate it to a text read', quarterTerm: 'Q1' },
    // Grade 10 additions
    { id: 'g10-sci-2', code: 'S10MT-Ia-b-2', gradeLevel: 'Grade 10', subject: 'Science', description: 'Recognize the major categories of biomolecules such as carbohydrates, lipids, proteins, and nucleic acids', quarterTerm: 'Q1' },
    { id: 'g10-fil-1', code: 'F10PN-Ia-b-1', gradeLevel: 'Grade 10', subject: 'Filipino', description: 'Naibibigay ang mahahalagang detalye ng napakinggang balita o teksto', quarterTerm: 'Q1' },
    // GMRC / Values sample
    { id: 'g4-gmrc-1', code: 'GMRC4-Ia-1', gradeLevel: 'Grade 4', subject: 'GMRC', description: 'Naipapakita ang paggalang sa sarili at sa kapwa', quarterTerm: 'Q1' },
    // EPP/TLE sample
    { id: 'g6-epp-1', code: 'EPP6IA-Oa-1', gradeLevel: 'Grade 6', subject: 'EPP/TLE', description: 'Demonstrates knowledge and skills in the use of tools and equipment in agriculture', quarterTerm: 'Q1' },
    // MAPEH samples
    { id: 'g6-mapeh-1', code: 'MU6CM-Ia-1', gradeLevel: 'Grade 6', subject: 'MAPEH', description: 'Demonstrates understanding of musical concepts related to rhythm', quarterTerm: 'Q1' },
    { id: 'g8-pe-1', code: 'PE8PF-Ia-1', gradeLevel: 'Grade 8', subject: 'MAPEH', description: 'Undertakes physical activity and physical fitness assessments', quarterTerm: 'Q1' },
  ];
}

export function searchCompetencies(store, { grade, subject, q } = {}) {
  let list = [...store];
  if (grade && grade !== 'All') list = list.filter((c) => c.gradeLevel === grade);
  if (subject && subject !== 'All') list = list.filter((c) => c.subject === subject);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((c) => c.description.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle));
  }
  return list.slice(0, 100);
}
